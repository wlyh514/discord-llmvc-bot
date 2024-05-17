import { textToSpeech } from '../speech';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.time('TTS');
  const stream = await textToSpeech('Hello, how are you today? This message might be long because I want to test the streaming ability of the library. ');


  console.timeEnd('TTS');
}

main()