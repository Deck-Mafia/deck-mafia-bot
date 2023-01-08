import { ActionRow, ActionRowBuilder, APISelectMenuOption, CommandInteraction, SelectMenuComponentOptionData, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { prisma } from '..';
import { newSlashCommand, SlashCommand } from '../structures/SlashCommand';
import string from 'string-similarity';

const c = new SlashCommandBuilder();
c.setName('reveal');
c.setDescription('Reveal any amount of cards that you own.');

export default newSlashCommand({
	data: c,
	async execute(i: CommandInteraction) {
		try {
			const ownedCards = await prisma.ownedCard.findMany({
				where: {
					inventory: {
						discordId: i.user.id,
					},
				},
				include: {
					card: true,
				},
			});

			let ownedCardList: SelectMenuComponentOptionData[] = [];
			ownedCards.forEach((v) => {
				ownedCardList.push({
					label: v.card.name,
					value: v.id,
				});
			});

			const row = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(new StringSelectMenuBuilder().setCustomId('reveal-cards').setOptions(ownedCardList).setPlaceholder('Select all the cards you want to show.').setMaxValues(ownedCardList.length).setMinValues(0));

			i.reply({
				components: [row.toJSON()],
				ephemeral: true,
			});
		} catch (err) {
			await i.reply({
				ephemeral: true,
				content: 'An unexpected error has occurred when fetching this card',
			});
			console.error(err);
		}
	},
});
