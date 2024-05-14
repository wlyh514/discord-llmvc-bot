import fs from 'node:fs';
import { EndBehaviorType, VoiceReceiver } from '@discordjs/voice';
import type { User } from 'discord.js';
import * as prism from 'prism-media';
import { FileWriter } from 'wav';
import { openai } from './globals';

function getDisplayName(userId: string, user?: User) {
	return user ? `${user.username}_${user.discriminator}` : userId;
}

export function createListeningStream(receiver: VoiceReceiver, userId: string, user?: User) {
	const opusStream = receiver.subscribe(userId, {
		end: {
			behavior: EndBehaviorType.AfterSilence,
			duration: 1500,
		},
	});

  const opusDecoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 2, 
    frameSize: 960
  })

  // TODO: Pipe the openai upload stream from memory?
  const filename = `./audio/${Date.now()}-${getDisplayName(userId, user)}.wav`;
  const wavWriterStream = new FileWriter(filename, {
    sampleRate: 48000, 
    channels: 2,
  });

	console.log(`👂 Started recording ${filename}`);
  return opusStream
    .pipe(opusDecoder)
    .pipe(wavWriterStream)
    .on('done', async () => {
      console.log(`Recording saved to ${filename}`);
      const transcription = await openai.audio.transcriptions.create({model: 'whisper-1', file: fs.createReadStream(filename)});
      console.log(getDisplayName(userId, user), ':', transcription.text);
      fs.promises.rm(filename);
    });
}