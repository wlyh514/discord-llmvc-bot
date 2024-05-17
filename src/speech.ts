import { AudioReceiveStream, AudioResource, StreamType, createAudioResource } from '@discordjs/voice';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import * as prism from 'prism-media';
import FormData from 'form-data';
import wav from 'wav';

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
      voice: 'alloy',
      response_format: 'opus',
      speed: 1.2,
    })
  });

  if (!resp.body) return null;

  return createAudioResource(
    Readable.from(resp.body, { objectMode: false }),
    { inputType: StreamType.Arbitrary }
  );
}

export async function speechToText(opusStream: AudioReceiveStream): Promise<string> {
    const nonce = crypto.randomBytes(4).toString('hex');;
    const opusDecoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960
    })
  
    // TODO: Pipe the openai upload stream from memory?
    const filename = `./audio/${Date.now()}-${nonce}.wav`;
    const wavWriterStream = new wav.Writer({
      sampleRate: 48000,
      channels: 2,
    });

    const sttFormData = new FormData();
    sttFormData.append('file', opusStream.pipe(opusDecoder).pipe(wavWriterStream), {filename: 'audio.wav'});
    sttFormData.append('model', 'whisper-1');
    sttFormData.append('prompt', 'Hey GPT, can you tell me a joke? ');
    sttFormData.append('response_format', 'text');


    return new Promise((res, rej) => {
      sttFormData.submit({
        host: 'api.openai.com',
        path: '/v1/audio/transcriptions', 
        protocol: 'https:', 
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`}
      }, (err, resp) => {
        if (err) {
          rej(err);
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
  
        resp.on('end', () => {
          resp.destroy();
          res(transcription);
        });
      })
    });
}
