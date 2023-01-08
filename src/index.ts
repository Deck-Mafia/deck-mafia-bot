import { PrismaClient } from '@prisma/client';
import { Client, Collection, Events, GatewayIntentBits, MessageCreateOptions, MessagePayload } from 'discord.js';
import path from 'path';
import config from './config';
import fs from 'fs';
import { commands, loadCommands, SlashCommand } from './structures/SlashCommand';
import card from './commands/card';

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

client.on(Events.InteractionCreate, async (i) => {
	if (!i.isStringSelectMenu()) return;
	if (i.customId === 'reveal-cards') {
		const values = i.values;
		let urls: string[] = [];
		for (let i = 0; i < values.length; i++) {
			const card = await prisma.ownedCard.findUnique({
				where: {
					id: values[i],
				},
				include: {
					card: true,
				},
			});

			if (card) urls.push(card.card.uri);
		}

		for (let index = 0; index < urls.length; index++) {
			if (i.channel) {
				i.channel.send({ content: `[${index + 1}/${urls.length}]<@${i.user.id}> has submitted\n${urls[index]}` });
			}
		}

		i.reply({ content: 'Done', ephemeral: true });
	}
});

(async () => {
	client.login(config.discordBotToken);
})();
