import { BaseMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { END, MemorySaver, START, StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { WebBrowser } from 'langchain/tools/webbrowser';
import { search } from 'duck-duck-scrape';
import z from 'zod';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import dotenv from 'dotenv';
import { patchFautyFunctionCall } from '../utils';
dotenv.config();

interface IState {
  messages: BaseMessage[];
}

const systemPrompt = `You are a voice assistant called GPT. You will be presented with transcriptions of a multi-user voice channel, in the form of (<userId>,<username>):<text>. Users will try to start a conversation with you by directly referencing you e.g.'Hey GPT', or expect your response by replying to your previous response. If you feel they are expecting a response from you, output your response. Otherwise do not call any tool and output <NULL>.

To make your response visible to the user, you have to call the 'reply' tool. You have two methods of responding, by voice output or by text channel. Normally you should use the voice channel to reply to users. If your reply include code blocks, email templates or if the user explicitly tells you to output to the text channel, print them to the text channel and tell the user via voice to check the text channel. 

You have access to the internet. When feel uncertain, do not make assumptions and call the 'duckduckgo-search' tool. If the search result snippets is not informative enough, you can use 'web-browser' to get the page summary. 

Try to be friendly, casual, natural and human-like. 
`;


const graphState: StateGraphArgs<IState>['channels'] = {
  messages: {
    reducer: (oldMsgs, newMsgs) => {
      // console.log('history', oldMsgs.concat(newMsgs))
      return oldMsgs.concat(newMsgs);
    },
    default: () => [new SystemMessage(systemPrompt)],
  }
}

const webBrowserTool = new WebBrowser({
  model: new ChatOpenAI({ temperature: 0, model: 'gpt-4o',}),
  embeddings: new OpenAIEmbeddings(),
})
const tools = [
  new DynamicStructuredTool({
    name: 'reply',
    description: 'Reply to a user in the transcript. This is the only method to let your response be seen by the users. ',
    schema: z.object({
      text: z.string().optional().describe('Your output to the text channel.'),
      voice: z.object({
        recepients: z.array(z.string()).describe('UserIds of users you are replying to.'),
        transcription: z.string().describe('Content of your voice reply. '),
      }).describe('You output to the voice channel. ')
    }),
    func: async (input) => {
      // console.log('reply', input);
      return 'reply received by users. ';
    },
  }),
  new DynamicStructuredTool({
    name: 'duckduckgo-search',
    description: 'A search engine. Useful for when you need to answer questions about current events. Input should be a search query.',
    schema: z.object({ 
      seqrchQuery: z.string().describe('The search query. '),
      responseToUser: z.string().describe(`A response the user while the search takes place. e.g. "Searching the internet for ..., please stand by."`),
    }),
    func: async ({ seqrchQuery }) => {
      const { results } = await search(seqrchQuery);
      return JSON.stringify(results
        .map((result) => ({
          title: result.title,
          link: result.url,
          snippet: result.description,
        }))
        .slice(0, 3));
    }
  }),
  new DynamicStructuredTool({
    name: 'web-browser',
    description: `useful for when you need to find something on or summarize a webpage.`,
    schema: z.object({
      url: z.string().describe('URL of the webpage to be searched. '),
      searchFor: z.string().describe('The information you wish to obtain from the webpage. ')
    }),
    func: async ({ url, searchFor }) => {
      return await webBrowserTool.invoke(`"${url}","${searchFor}"`);
    }
  })
] as const;

const toolNode = new ToolNode<IState>(tools as any);

const llm = new ChatOpenAI({
  model: 'gpt-4o',
  temperature: 0,
}).bindTools(tools as any);

const routeMessage = (state: IState) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  // If no tools are called, we can finish (respond to the user)
  if (!lastMessage.tool_calls?.length) {
    patchFautyFunctionCall(lastMessage);
    if (lastMessage.tool_calls?.length) {
      return 'tools';
    }
    return END;
  }
  // Otherwise if there is, we continue and call the tools
  return "tools";
};

const actionTools = ['reply'];
const execTools = ({ messages }: IState) => {
  let lastAIMsgIndx = messages.length - 1;
  for (; lastAIMsgIndx >= 0; lastAIMsgIndx--) {
    if (messages[lastAIMsgIndx] instanceof AIMessage) {
      break;
    }
  }
  const lastAIMessage = messages[lastAIMsgIndx];
  if (lastAIMessage instanceof AIMessage && lastAIMessage.tool_calls?.map(({ name }) => actionTools.includes(name)).reduce((prev, curr) => prev && curr, true)) {
    messages.push(new AIMessage(''));
    return END;
  }

  return 'agent';
}

const callModel = async (
  state: IState,
) => {
  const { messages } = state;
  const response = await llm.invoke(messages);
  return { messages: [response] };
};

const workflow = new StateGraph<IState>({
  channels: graphState,
})
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeMessage)
  // .addEdge('tools', 'agent')
  .addConditionalEdges('tools', execTools)

const memory = new MemorySaver();

const graph = workflow.compile({ checkpointer: memory });

export { graph };
export type { tools };