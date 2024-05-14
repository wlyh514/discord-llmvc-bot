import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import commands from '../commands';
dotenv.config();

async function main() {
  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN!);

  try {
    const data = await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), { body: commands });
    console.log(`Successfully reloaded ${(data as any).length} application (/) commands.`);
  } catch (err) {
    console.error(err);
  }
}

main();
