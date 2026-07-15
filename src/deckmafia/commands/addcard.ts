import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { MessageFlags } from "discord.js";
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('add');
c.setDescription('Add or update a card in the database');
c.addStringOption((input) => input.setName('name').setDescription('Name of the card').setRequired(true));
c.addStringOption((input) => input.setName('url').setDescription('URL of the image').setRequired(true));
c.addIntegerOption((input) => input.setName('rarity').setDescription('Rarity of the card').setRequired(true));
c.addBooleanOption((i) => i.setName('public').setDescription('Is the card supposed to be public and known to all? Default is no').setRequired(false));

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		const name = i.options.get('name', true).value as string;
		const url = (i.options.get('url', true).value as string).split('?')[0];
		const rarity = i.options.get('rarity', true).value as number;
		const publicOption = i.options.get('public', false);
		const isPublic = publicOption ? (publicOption.value as boolean) : false;

		try {
			const result = await prisma.card.upsert({
				where: { name: name.toLowerCase() },
				update: {
					uri: url,
					isPublic,
					rarity,
				},
				create: {
					name: name.toLowerCase(),
					uri: url,
					isPublic,
					rarity,
				},
			});

			await i.reply(`Card \`${result.name}\` ${result.rarity !== null ? `(${result.rarity}★)` : ''} ${result.isPublic ? '(Public)' : '(Hidden)'}\n${result.uri}`);
		} catch (err) {
			await i.reply({
				flags: MessageFlags.Ephemeral,
				content: 'An unexpected error when adding a card has occurred',
			});
		}
	},
});