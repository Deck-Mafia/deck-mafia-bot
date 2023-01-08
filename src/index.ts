import { PrismaClient } from '@prisma/client';
import { Client, Collection, Events, GatewayIntentBits } from 'discord.js';
import path from 'path';
import config from './config';
import fs from 'fs';
import { commands, loadCommands, SlashCommand } from './structures/SlashCommand';

export const prisma = new PrismaClient();

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on(Events.ClientReady, async (c) => {
	console.log(`Ready! Logged in as ${c.user.tag}`);

	await loadCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	const command = commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});

(async () => {
	client.login(config.discordBotToken);
})();
