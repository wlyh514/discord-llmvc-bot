// index.js
import { Client, CommandInteraction, GuildMember } from 'discord.js';
import { VoiceConnection, VoiceConnectionReadyState, VoiceConnectionStatus, entersState, getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import dotenv from 'dotenv';
import { createListeningStream } from './listeningStream';
dotenv.config();


async function join(
	interaction: CommandInteraction,
	client: Client,
	connection?: VoiceConnection,
) {
	await interaction.deferReply();
	if (!connection) {
		if (interaction.member instanceof GuildMember && interaction.member.voice.channel) {
			const channel = interaction.member.voice.channel;
			connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: channel.guild.id,
				selfDeaf: false,
				selfMute: false,
				adapterCreator: channel.guild.voiceAdapterCreator,
			});
			connection.on('stateChange', (_oldstate, newState) => {
				console.log('state update:', newState.status); 
			});
			connection.on('error', console.error);
			connection.on('debug', console.log);
		} else {
			await interaction.followUp('You need to be in a voice channel to use this command.');
			return;
		}
	}

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
		// ((connection.state as VoiceConnectionReadyState).networking.state as any).udp.on('message', console.log); // UDP stops receiving msg after some seconds. Why? 
		((connection.state as VoiceConnectionReadyState).networking.state as any).udp.on('close', () => console.log('udp closed')); 
		((connection.state as VoiceConnectionReadyState).networking.state as any).udp.on('debug', (msg: any) => console.log('udp debug', msg)); 
		((connection.state as VoiceConnectionReadyState).networking.state as any).udp.on('error', (msg: any) => console.log('udp error', msg)); 
		const receiver = connection.receiver;
		const startTime = new Date();
		receiver.speaking.on('start', (userId) => {
			console.log(Date.now() - startTime.getTime(), client.users.cache.get(userId)?.displayName, 'started');
			// createListeningStream(receiver, userId, client.users.cache.get(userId));
		})
		receiver.speaking.on('end', (userId) => {
			console.log(Date.now() - startTime.getTime(), client.users.cache.get(userId)?.displayName, 'stopped');
		})



	} catch (error) {
		console.warn(error);
		await interaction.followUp('Failed to join voice channel within 20 seconds, please try again later!');
	}

	await interaction.followUp('Ready!');
}

async function leave(
	interaction: CommandInteraction,
	_client: Client,
) {
	const connection = getVoiceConnection(interaction.guildId!);
	if (connection) {
		connection.destroy();
		await interaction.reply({ content: 'Left the channel!' });
	} else {
		await interaction.reply({ content: 'Not playing in this server!' });
	}
}

const client = new Client({ intents: ['Guilds', 'GuildVoiceStates', 'GuildMessages'] });

client.once('ready', () => {
	console.log(`Logged in as ${client.user?.tag}!`);
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isChatInputCommand()) return;
	// Ignore bot interactions
	if (interaction.user.bot) return;

	const { commandName } = interaction;

	if (commandName === 'ping') {
		await interaction.reply('pong!');
	} else if (commandName === 'vc') {
		await join(interaction, client);
	} else if (commandName === 'leave') {
		await leave(interaction, client);
	}
});

client.login(process.env.DISCORD_BOT_TOKEN);
