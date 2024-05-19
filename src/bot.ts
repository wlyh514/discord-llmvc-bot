// index.js
import { Client, CommandInteraction } from 'discord.js';
import { VoiceConnectionStatus, entersState, getVoiceConnection } from '@discordjs/voice';
import dotenv from 'dotenv';
import { Conversation } from './conversation';
import { joinVCOfInteraction } from './utils';
import { PerformanceObserver } from 'node:perf_hooks';
dotenv.config();

async function join(
	interaction: CommandInteraction,
	client: Client,
) {
	await interaction.deferReply();
	const connection = await joinVCOfInteraction(interaction);

	if (connection === null) {
		await interaction.followUp('You need to be in a voice channel to use this command.');
		return;
	}

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
		const conversation = new Conversation(client, interaction, connection);
		conversation.start();
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

const obs = new PerformanceObserver((li) => {
	li.getEntries().forEach(item => console.log(item.name, item.duration));
});
obs.observe({ type: 'measure' });

client.login(process.env.DISCORD_BOT_TOKEN);
