import { EventEmitter } from 'node:events';
import crypto from 'crypto';
import { graph } from './soul';
import { AIMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { patchFautyFunctionCall } from '../utils';

type ToolCall<T extends DynamicStructuredTool> = {
  name: T['name'], 
  id?: string, 
  args: z.infer<T['schema']>
};


class Soul {

  private threadId = crypto.randomUUID();
  private _status: 'idle' | 'loading' | 'tool_calling' = 'idle';
  private taskQueue: number[] = [];
  private taskQueueEventEmitter = new EventEmitter<{
    'ready': [number]
  }>();
  private taskCounter = 0;

  get status() {
    return this._status;
  }

  end() {
    graph.updateState({
      configurable: { thread_id: this.threadId },
    }, null);
  }
  
  async invoke(input: string) {
    if (this.taskQueue.length === 0) {
      return this._invoke(input);
    }
    const taskId = this.taskCounter++;

    return new Promise<AsyncGenerator<ToolCall<any>, null>>(res => {
      const onReady = (readyTaskId: number) => {
        if (readyTaskId === taskId) {
          this.taskQueueEventEmitter.off('ready', onReady);
          res(this._invoke(input));
        }
      }
      this.taskQueueEventEmitter.on('ready', onReady);
    });
  }

  private async *_invoke(input: string) {
    this._status = 'loading';
    for await (const { messages } of await graph.stream(
      { messages: [['user', input]] }, {
        configurable: { thread_id: this.threadId }, 
        streamMode: 'values',
      }
    )) {
      const msg = messages.at(-1);
      if (msg instanceof AIMessage) {
        if (msg.content && msg.content === '<NULL>') {
          break;
        }
        if (msg.tool_calls && msg.tool_calls?.length > 0) {
          this._status = 'tool_calling';
          for (const toolCall of msg.tool_calls) {
            yield toolCall;
          }
        }
      }
    }
    if (this.taskQueue.length > 0) {
      const [ nextTaskId ] = this.taskQueue.splice(0, 1);
      this.taskQueueEventEmitter.emit('ready', nextTaskId);
    } else {
      this._status = 'idle';
    }
    
    return null;
  }
}


export { Soul };