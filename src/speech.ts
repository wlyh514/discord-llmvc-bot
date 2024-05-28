/**
 * TTS and STT happens here. 
 */

import { AudioReceiveStream, AudioResource, StreamType, createAudioResource } from '@discordjs/voice';
import { Readable, PassThrough } from 'node:stream';
import * as prism from 'prism-media';
import FormData from 'form-data';
import wav from 'wav';
import { NonRealTimeVAD } from '@ricky0123/vad-node';


const CHANNELS = 2;
const SAMPLE_RATE = 48000;
const FRAME_SIZE = 960;
const vad = NonRealTimeVAD.new({
  positiveSpeechThreshold: 0.85,
  negativeSpeechThreshold: 0.8,
  // minSpeechFrames: 0.15 * (SAMPLE_RATE / 1536)
});

export async function textToSpeech(text: string): Promise<AudioResource | null> {
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: 'echo',
      response_format: 'opus',
      speed: 1,
    })
  });

  if (!resp.body) return null;

  return createAudioResource(
    Readable.from(resp.body, { objectMode: false }),
    { inputType: StreamType.Arbitrary }
  );
}

export async function speechToText(opusStream: AudioReceiveStream): Promise<string> {
  const opusDecoder = new prism.opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: FRAME_SIZE
  });

  // TODO: Employ VAD to detect empty/noise audio. 
  const wavWriterStream = new wav.Writer({
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
  });

  const wavStream = opusStream.pipe(opusDecoder).pipe(wavWriterStream);
  const httpUploadStream = new PassThrough();
  const vadInputStream = new PassThrough();
  wavStream.pipe(httpUploadStream);
  wavStream.pipe(vadInputStream);


  const vadPromise = new Promise<boolean>((res, rej) => {
    const chunks: Uint8Array[] = [];

    // TODO: Store to FS when needed to prevent memory depletion.
    vadInputStream.on('data', chunk => {
      chunks.push(chunk);
    })

    vadInputStream.on('error', err => {
      rej(err);
    })

    vadInputStream.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      const file = new Float32Array(buffer.buffer, 0, Math.floor(buffer.length / 4));
      const result = (await vad).run(file, SAMPLE_RATE);

      let totalSpeakingFrames = 0;
      for await (const { start, end } of result) {
        totalSpeakingFrames += (end - start);
      }

      res(totalSpeakingFrames > 0);
    });
  });

  const sttFormData = new FormData();
  sttFormData.append('file', httpUploadStream, { filename: 'audio.wav' });
  sttFormData.append('model', 'whisper-1');
  sttFormData.append('prompt', 'Hey GPT. ');
  sttFormData.append('response_format', 'text');
  sttFormData.append('temperature', 0);

  const controller = new AbortController();

  const sttPromise = new Promise<string>((res, rej) => {
    sttFormData.submit({
      host: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      protocol: 'https:',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: controller.signal, 
    }, (err, resp) => {
      if (err) {
        if (err.name === 'AbortError') {
          res('');
        } else {
          rej(err);
        }
        return;
      }
      if (resp.statusCode! >= 300) {
        rej(resp.statusCode);
        return;
      }

      let transcription = '';
      resp.on('data', data => {
        transcription += data.toString() // UTF-8
      });

      resp.on('end', async () => {
        resp.destroy();
        res(transcription);
      });
    })
  });

  const someResult = await Promise.race([sttPromise, vadPromise]);
  return new Promise<string>(async (res) => {
    // STT finished first
    if (typeof someResult === 'string') {
      const transcription = someResult;
      try {
        const isSpeech = await vadPromise;
        if (!isSpeech) {
          res(''); 
        } else {
          res(transcription);
        }
      } catch (err) {
        console.error(err);
        res('');
      }
    }
    // AVD finished first
    if (typeof someResult === 'boolean') {
      const isSpeech = someResult;
      if (!isSpeech) {
        res(''); 
      } else {
        try {
          const transcription = await sttPromise;
          res(transcription);
        } catch (err) {
          console.error(err);
          res('');
        }
      }
    }
  })

}
