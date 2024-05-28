import { VoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { AIMessage } from '@langchain/core/messages';
import { Client, CommandInteraction, GuildMember } from 'discord.js';
import jsonc from 'jsonc-parser';
import crypto from 'node:crypto';

export async function getUser(client: Client, userId: string) {
	return client.users.cache.get(userId) ?? (await client.users.fetch(userId));
}


export async function joinVCOfInteraction(interaction: CommandInteraction): Promise<VoiceConnection | null> {
  if (interaction.member instanceof GuildMember && interaction.member.voice.channel) {
    const channel = interaction.member.voice.channel;
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      selfDeaf: false,
      selfMute: false,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });
    return connection;
  } else {
    return null;
  }
}

/**
 * Maunally parse and rectify a faulty tool calling response from gpt-4o. 
 * @param {AIMessage} msg 
 * @returns {void}
 */
export function patchFautyFunctionCall(msg: AIMessage): void {
  if (!msg.content || typeof msg.content !== 'string') {
    return;
  }
  const matchResult = msg.content.match(/functions\.(.*?)[\(\n]/);
  if (!matchResult) {
    return;
  }

  // The string that comes after functions.${function_name}(
  // If the argument is an object, gpt-4o sometimes omits double quotes around attribute names, making it a invalid JSON string. quotifyJSONString adds the missing quotation marks. 
  const jsonString = quotifyJSONString(msg.content.substring((matchResult.index ?? 0) + matchResult[0].length));
  const [jsonObj, prefixLen] = parseJSONPrefix(jsonString);
  if (prefixLen === 0) {
    return;
  }
  msg.content = jsonString.substring(jsonString[prefixLen] === ')' ? prefixLen + 1 : prefixLen);
  if (msg.tool_calls === undefined) {
    msg.tool_calls = [];
  }
  msg.tool_calls.push({
    name: matchResult[1],
    args: jsonObj,
    id: crypto.randomUUID(),
  });
}

function quotifyJSONString(unquotedJson: string): string {
  const attributePattern = /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g;

  // Replace unquoted attribute names with quoted ones
  return unquotedJson.replace(attributePattern, '$1"$2"$3');
}

/**
 * Try to parse the prefix of a JSON string into an object.
 * @param {string} str A string that might have a valid JSON prefix.
 * @returns {[any, number]} [The parsed object, size of the valid JSON prefix]
 */
function parseJSONPrefix(str: string): [any, number] {
  const errors: jsonc.ParseError[] = [];
  const obj = jsonc.parse(str, errors);

  if (errors.length === 0) {
    return [obj, str.length];
  }
  if (errors[0].offset === 0) {
    // No valid prefix
    return [undefined, 0];
  }

  return [obj, errors[0].offset];
}

export class MultiSet<K> {
  private map = new Map<K, number>();

  add(key: K): number {
    let val = this.map.get(key) ?? 0;
    this.map.set(key, val++);
    return val;
  }

  subtract(key: K): number {
    let val = (this.map.get(key) ?? 0) - 1;
    if (val <= 0) {
      this.map.delete(key);
      return 0;
    }
    this.map.set(key, val);
    return val;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }
}

export class IncrIdMapper<T> {
  private itemToId = new Map<T, number>();
  private idToItem = new Map<number, T>();
  private counter = 0;

  getIdOfItem(item: T): number {
    const id = this.itemToId.get(item);
    if (typeof id === 'number') {
      return id;
    }
    this.counter++;
    this.idToItem.set(this.counter, item);
    this.itemToId.set(item, this.counter);
    return this.counter;
  }

  getItemById(id: number): T | undefined {
    return this.idToItem.get(id);
  }

  delete(id: number) {
    const item = this.idToItem.get(id);
    if (item) {
      this.idToItem.delete(id);
      this.itemToId.delete(item); 
    } 
  }
}