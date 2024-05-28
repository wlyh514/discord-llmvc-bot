import dotenv from 'dotenv';
import { graph } from '../soul/soul';
import { AIMessage } from '@langchain/core/messages';
import { patchFautyFunctionCall } from '../utils';
dotenv.config();


async function invoke(msg: string) {
  let inputs = { messages: [["user", msg]] };
  for await (
    const { messages } of await graph.stream(inputs, {
      configurable: { thread_id: 'threadid' },
      streamMode: "values",
    })
  ) {
    let msg = messages[messages?.length - 1];
    if (msg?.content) {
      console.log('raw content:', msg.content);
    }

    if (msg instanceof AIMessage) {
      if (!msg.tool_calls?.length) {
        patchFautyFunctionCall(msg);
        console.log('ai message after patching:', msg);
      }
    }

    if (msg?.tool_calls?.length > 0) {
      console.log('tool calls:', msg.tool_calls);
    }
    console.log("-----\n");
  }
}

async function main() {
  // await invoke('(0,Adam): Hey GPT, can you tell a joke? ');
  await invoke('(0,void *): How are you doing, GPT?');
  // const state = await graph.getState({ configurable: { thread_id: 'threadid' }});

  // await invoke('(0,Adam): Hey GPT, what will the weather be like tomorrow in Toronto? ')

  // await invoke('(0,Adam): So yesterday I have been fishing. \n(1,Brian): Yeah? Tell me about it. ');
  // await invoke('(1,user01): Yo GPT, what did user00 do yesterday?')

  // await invoke('(2,void *): Hey GPT, how do I write hello world in java? \n(0,Adam): I caught a huge Trout!  ');
  // await invoke('(1,Brian): A TROUT? Sick! By the way what should I have for dinner? ');
  // await invoke('(2,void *): Thanks GPT, can you tell me a joke? \n(0,Adam): What about pizza? ');

  // await invoke('(0,Adam): GPT, 请告诉我关于伊朗直升机事故相关的信息.');

  // const msg = new AIMessage('functions.reply\n' +'{\n' +
  // '  voice: {\n' +
  // '    recepients: ["0"],\n' +
  // '    transcription: "Hey there! How can I assist you today?"\n' +
  // '  }\n' +
  // '}');

  // patchFautyFunctionCall(msg);
  // console.log(msg.tool_calls);
}
main();