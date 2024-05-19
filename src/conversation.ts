import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { AudioPlayerStatus, EndBehaviorType, VoiceConnection, VoiceConnectionStatus, VoiceReceiver, createAudioPlayer, entersState } from '@discordjs/voice';
import { speechToText, textToSpeech } from './speech';
import { Soul } from './soul/chain';
import { Client, CommandInteraction } from 'discord.js';
import { getUser } from './utils';

type Transcription = {
  userId: UserId;
  text: string;
}
type UserId = string;


class TranscriptionExtractor extends EventEmitter<{
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
    if ((await getUser(this.client, userId)).bot) return;
    if (this.speakers.has(userId)) {
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
        performance.mark(userId + 'speaking_end');
      });
    try {
      const transcription = (await speechToText(opusStream)).trim();
      if (transcription.length === 0) return;
      this.emit('transcriptionReady', { userId, text: transcription });
    } catch (err) {
      console.error('STT failed. ');
    }

  }
}

class Conversation {
  private player = createAudioPlayer();

  private transcriptions = {
    processing: new Map<UserId, string>(),
    pending: new Map<UserId, string>(),
  }

  private transcriptionExtractor: TranscriptionExtractor;
  private soul = new Soul();

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

    this.transcriptionExtractor.on('transcriptionReady', ({ userId, text }) => {
      // 'append' this transcription to pending transcriptions
      performance.mark(userId + 'tts_end');
      performance.measure('TTS', userId + 'speaking_end', userId + 'tts_end');
      const userTranscrption = (this.transcriptions.pending.get(userId) ?? '') + ' ' + text;
      this.transcriptions.pending.set(userId, userTranscrption);
      console.log('isProcessing', this.isProcessing());
      if (!this.isProcessing()) {
        this.processTranscriptions();
      }
    });

    this.player.on(AudioPlayerStatus.Idle, () => {
      // Process pending transcriptions after the previous response is played.
      this.transcriptions.processing.clear();
      this.processTranscriptions();
    });


    this.conn.on(VoiceConnectionStatus.Disconnected, async () => {
      // Attempt to reconnect upon disconnection
      try {
        await Promise.race([
          entersState(this.conn, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.conn, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch (err) {
        this.conn.destroy();
      }
    });

    this.conn.on(VoiceConnectionStatus.Destroyed, () => {
      // Free resources upon connection destroyed
      this.end();
    });
  }

  private isProcessing() {
    return this.transcriptions.processing.size > 0;
  }

  private async processTranscriptions() {
    this.transcriptions.processing.clear();
    for (const [uid, tr] of this.transcriptions.pending) {
      this.transcriptions.processing.set(uid, tr);
    }
    this.transcriptions.pending.clear();

    for (const [uid, tr] of this.transcriptions.processing) {
      console.log((await getUser(this.client, uid)).displayName, ':', tr);
    }

    if (this.transcriptions.processing.size === 0) {
      return;
    }

    // Convert userids into display names, send transctiptions to the LLM. 
    const resp = await this.soul.chat(
      await Promise.all([...this.transcriptions.processing.entries()]
        .map(async ([userId, text]) => ({ username: (await getUser(this.client, userId)).displayName, text }))
      )
    );

    for (const uid of this.transcriptions.processing.keys()) {
      performance.mark(uid + 'llm_end');
      performance.measure('LLM', uid + 'tts_end', uid + 'llm_end');
    }

    console.log('AI:', resp);
    if (!resp) {
      this.transcriptions.processing.clear();
      return;
    }
    const speechStream = await textToSpeech(resp);
    if (speechStream) {
      this.player.play(speechStream);
    }
  }

  end() {
    this.conn.removeAllListeners();
    this.player.removeAllListeners();
    this.transcriptionExtractor.end();
  }
}

export { Conversation };