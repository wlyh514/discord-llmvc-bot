import { VoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { Client, CommandInteraction, GuildMember } from 'discord.js';

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