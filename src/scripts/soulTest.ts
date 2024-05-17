import { Soul } from '../soul/chain';

async function main() {
  const soul = new Soul();

  console.log(0, await soul.chat('user01: So yesterday I have been fishing. \nuser01: Yeah? tell me about it. '));
  console.log(1, await soul.chat('user01: Hey GPT, tell me a joke! '));
  console.log(2, await soul.chat('user00: Great one, thanks! Can you tell another one? '));
  console.log(3, await soul.chat('user01: Yeah, so what fish did you catch? '));
}
main();