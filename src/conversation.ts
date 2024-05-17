import { EventEmitter } from 'node:events';

import { EndBehaviorType, VoiceConnection, VoiceReceiver } from '@discordjs/voice';
import { speechToText } from './speech';

type SpeakerStatus = {
	isSpeaking: boolean;
	transcriptText: string;
}
type Transcription = {
  userId: UserId; 
  text: string;
}
type UserId = string;


/**
 * 
 */
class Conversation extends EventEmitter<{
  'transcriptionReady': Transcription[];
}> {

  speakers = new Map<UserId, SpeakerStatus>();

  constructor(
    private receiver: VoiceReceiver
  ) {
    super();
    this.receiver.speaking.on('start', (userId) => this.onSpeakingStart(userId));
    const interval = setInterval(() => this.process(), 1000);
    this.receiver.voiceConnection.on('stateChange', (_, newState) => {
      if (newState.status === 'destroyed' || newState.status === 'disconnected') {
        clearInterval(interval);
      }
    })
  }

  async onSpeakingStart(userId: UserId) {

    if (this.speakers.has(userId)) {
      const status = this.speakers.get(userId)!;
      if (status.isSpeaking) return;
      status.isSpeaking = true;
    } else {
      this.speakers.set(userId, {
        isSpeaking: true, 
        transcriptText: '',
      });
    }
    console.time('tts' + userId);
    
    const opusStream = this.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500,
      },
    })
      .on('end', () => {
        this.speakers.get(userId)!.isSpeaking = false;
      });

    const transcription = await speechToText(opusStream);
    console.timeLog('tts' + userId, 'transcription got');
    console.timeEnd('tts' + userId);
    this.speakers.get(userId)!.transcriptText += transcription;
  }

  private process() {
    const transcriptions: Transcription[] = [];
    // Send a transcript to processing iff its speaker stopped speaking. 
    for (const [userId, status] of this.speakers) {
      if (!status.isSpeaking && status.transcriptText.length > 0) {
        transcriptions.push({ userId, text: status.transcriptText });
        status.transcriptText = '';
      }
    }
    if (transcriptions.length > 0) {
      this.emit('transcriptionReady', ...transcriptions);
    }
  }
}

export { Conversation };