import { SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with pong! '),
  new SlashCommandBuilder()
    .setName('vc')
    .setDescription('Join and start listening to a voice channel. '),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the current voice channel. '),
];


export default commands;