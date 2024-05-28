import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { AudioPlayerStatus, EndBehaviorType, VoiceConnection, VoiceConnectionStatus, VoiceReceiver, createAudioPlayer, entersState } from '@discordjs/voice';
import { speechToText, textToSpeech } from './speech';
import { Soul } from './soul/chain';
import { Client, CommandInteraction } from 'discord.js';
import { IncrIdMapper, MultiSet, getUser } from './utils';

type Transcription = {
  userId: UserId;
  text: string;
}
type UserId = string;


class TranscriptionExtractor extends EventEmitter<{
  'speakingStart': [UserId, Promise<string | null>];
  'speakingEnd': [UserId];
  'transcriptionReady': [Transcription];
}> {

  private speakers = new Set<UserId>();

  constructor(
    private client: Client,
    private receiver: VoiceReceiver
  ) {
    super();
  }

  start() {
    this.receiver.speaking.on('start', (userId) => this.onSpeakingStart(userId));
  }

  end() {
    this.receiver.speaking.removeAllListeners();
    this.removeAllListeners();
  }

  async onSpeakingStart(userId: UserId) {
    if (this.speakers.has(userId) || (await getUser(this.client, userId)).bot) {
      return;
    } else {
      this.speakers.add(userId);
    }

    const opusStream = this.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000,
      },
    })
      .once('end', () => {
        this.speakers.delete(userId);
        this.emit('speakingEnd', userId);
        performance.mark(userId + 'speaking_end');
      });

    const transcriptionPromise = (async () => {
      try {
        const transcription = (await speechToText(opusStream)).trim();
        if (transcription.length === 0) return null;
        return transcription;
      } catch (err) {
        console.error('STT failed. ');
        return null;
      }
    })();
    this.emit('speakingStart', userId, transcriptionPromise);

    const transcription = await transcriptionPromise;

    if (transcription) {
      this.emit('transcriptionReady', { userId, text: transcription });
    }

  }
}

class Conversation {
  private player = createAudioPlayer();

  private transcriptions = {
    processing: new Array<Transcription>(),
    pending: new Array<Transcription>(),
  }
  private pendingVoiceProcessing = new MultiSet<UserId>();
  private transcriptionExtractor: TranscriptionExtractor;
  private soul = new Soul();
  private focalUsers: UserId[] = [];
  private shortIdMapper = new IncrIdMapper<string>();

  constructor(
    private client: Client,
    private interaction: CommandInteraction,
    private conn: VoiceConnection,
  ) {
    this.conn.subscribe(this.player);
    this.transcriptionExtractor = new TranscriptionExtractor(this.client, this.conn.receiver);
  }

  start() {
    this.transcriptionExtractor.start();

    this.transcriptionExtractor
      .on('speakingStart', (userId, transcriptionPromise) => {
        this.pendingVoiceProcessing.add(userId);

        if (this.player.state.status === AudioPlayerStatus.Playing && this.focalUsers.includes(userId)) {
          // If the speaker is still speaking after 750ms, pause the current playing voice response. Voice shorter than 750 ms might be unfiltered noises. 
          let stillSpeaking = true; 
          const setStillSpeaking = (endUserId: string) => {
            if (endUserId === userId) {
              stillSpeaking = false; 
              this.conn.receiver.speaking.off('end', setStillSpeaking);
            }
          }
          this.conn.receiver.speaking.on('end', setStillSpeaking);
          setTimeout(async () => {  
            this.conn.receiver.speaking.off('end', setStillSpeaking);
            if (stillSpeaking) {
              this.player.pause(true);
            }
            if (await transcriptionPromise === null) {
              // If the interrupting speech TTS failed, resume the paused response. 
              this.player.unpause();
            }
          }, 750);
        }
      })
      .on('transcriptionReady', ({ userId, text }) => {
        // append this transcription to pending transcriptions
        performance.mark(userId + 'tts_end');
        performance.measure('TTS', userId + 'speaking_end', userId + 'tts_end');
        this.transcriptions.pending.push({ userId, text });
        this.pendingVoiceProcessing.subtract(userId);

        if (!this.pendingVoiceProcessing.has(userId) &&
          // All focal users has stopped speaking. 
          !this.focalUsers.map(uid => this.pendingVoiceProcessing.has(uid)).reduce((prev, curr) => prev || curr, false) && 
          !this.isProcessing()
        ) {
          this.processTranscriptions();
        }
      });

    this.conn
      .on(VoiceConnectionStatus.Disconnected, async () => {
        // Attempt to reconnect upon disconnection
        try {
          await Promise.race([
            entersState(this.conn, VoiceConnectionStatus.Signalling, 5000),
            entersState(this.conn, VoiceConnectionStatus.Connecting, 5000),
          ]);
        } catch (err) {
          this.conn.destroy();
        }
      })
      .on(VoiceConnectionStatus.Destroyed, () => {
        // Free resources upon connection destroyed
        this.end();
      });
  }

  private async transcriptionsToString(trs: Transcription[]): Promise<string> {
    return (await Promise.all(trs
      .map(async ({ userId, text }) => `(${this.shortIdMapper.getIdOfItem(userId)},${(await getUser(this.client, userId)).displayName}):${text}`)
    )).join('\n')
  }

  private isProcessing(): boolean {
    return this.soul.status !== 'idle';
  }

  private async sendText(text: string) {
    return this.interaction.channel?.send(text);
  }

  private async sendVoice(transctiption: string) {
    const speechStream = await textToSpeech(transctiption);
    if (speechStream) {
      this.player.play(speechStream);
    }
  }

  private async processTranscriptions() {
    this.transcriptions.processing = this.transcriptions.pending;
    this.transcriptions.pending = [];

    for (const { userId, text } of this.transcriptions.processing) {
      console.log((await getUser(this.client, userId)).displayName, ':', text);
    }

    if (this.transcriptions.processing.length === 0) {
      return;
    }
    console.log('processing transcriptions');

    // Call the LLM with the transcriptions in this.transcriptions.processing
    const toolCalls = await this.soul.invoke(await this.transcriptionsToString(this.transcriptions.processing));

    let isNullResponse = true;
    for await (const { name, args } of toolCalls) {
      isNullResponse = false;
      // console.log(name);
      switch (name) {
        case 'reply':
          if (args.text) {
            this.sendText(args.text);
          }
          this.sendVoice(args.voice.transcription);
          this.focalUsers = args.voice.recepients.map((shortId: string) => this.shortIdMapper.getItemById(parseInt(shortId)));
          console.log('AI to', args.voice.recepients, ':', args.voice.transcription);
          break;
        case 'duckduckgo-search':
          this.sendVoice(args.responseToUser);
          break;
      }
    }
    // When the audio stream is paused because of an user interrupt and the interrupt does not lead to new responses, resume the interrupted response
    if (isNullResponse) {
      this.focalUsers = [];
      if (this.player.state.status === AudioPlayerStatus.Paused) {
        this.player.unpause();
      }
    }

    for (const uid of new Set(this.transcriptions.processing.map(tr => tr.userId))) {
      performance.mark(uid + 'llm_end');
      performance.measure('LLM', uid + 'tts_end', uid + 'llm_end');
    }

    if (!toolCalls) {
      this.transcriptions.processing === null;
      return;
    }
  }

  end() {
    this.conn.removeAllListeners();
    this.player.removeAllListeners();
    this.transcriptionExtractor.end();
    this.soul.end();
  }
}

export { Conversation };