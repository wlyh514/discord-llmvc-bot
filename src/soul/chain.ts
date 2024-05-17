import { InMemoryChatMessageHistory } from '@langchain/core/chat_history';
import { AIMessage, BaseMessageLike, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import dotenv from 'dotenv';
dotenv.config();

class Soul {
  static chain = getChain();
  static systemPrompt = 'You are a voice assisstant called GPT. You will be presented with transcriptions of a multi-user voice channel, in the form of <user>:<transcript>. They will try to start a conversation with you by saying "Hey GPT", or by replying to your previous response. If you feel they are expecting a response from you, output your response. Otherwise output <NULL>. ';

  history = new InMemoryChatMessageHistory([
    new SystemMessage(Soul.systemPrompt),
  ])

  async chat(newMsg: string): Promise<string | null> {
    await this.history.addUserMessage(newMsg);
    // TODO: stream? 
    const resp = await Soul.chain.invoke(await this.history.getMessages());
    await this.history.addAIMessage(resp);
    if (resp.trim() === '<NULL>') {
      return null;
    }
    return resp;
  }
}

function getChain() {
  const LLM = new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0.8
  });

  return LLM
    .pipe(new StringOutputParser());
}

export { Soul };