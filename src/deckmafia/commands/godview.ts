import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';
import { Card } from '.prisma/client';
import { send } from 'process';

const c = new SlashCommandBuilder();
c.setName('godview');
c.setDescription('View any card');
c.addStringOption((o) => o.setName('name').setDescription('Name of the card').setRequired(true));
c.addBooleanOption((i) => i.setName('hidden').setDescription('Do you wanna make this only visible to you? Default is no').setRequired(true));

async function getAllCardNames() {
	const cards = await prisma.card.findMany({});

	let cardNames: string[] = [];
	cards.forEach((card) => cardNames.push(card.name));

	return cardNames;
}

async function getClosestCardName(cardName: string, list: string[]) {
	console.log(cardName, list);
	const result = string.findBestMatch(cardName, list);
	return result;
}

async function getAllPrivateCards(discordId: string) {
	const fetchedCards = await prisma.card.findMany({
		where: {
			ownedCards: {
				some: {
					inventory: {
						discordId,
					},
				},
			},
		},
	});

	const allPrivateCards: Record<string, Card> = {};
	fetchedCards.forEach((card) => {
		allPrivateCards[card.name] = card;
	});
	return allPrivateCards;
}

export default newSlashCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const cardName = i.options.get('name', true).value as string;
		const ephemeral = i.options.get('hidden', true).value as boolean;
		try {
			const fetchedCard = await prisma.card.findFirst({
				where: {
					name: cardName.toLowerCase(),
				},
			});

			if (!fetchedCard) {
				const allPublicCardNames = await getAllCardNames();
				const allCards: string[] = allPublicCardNames;

				if (allCards.length > 0) {
					const closestCardName = await getClosestCardName(cardName, allCards);
					let message = `No card was found with that name, did you mean \`${closestCardName.bestMatch.target}\`?`;
					return await i.reply({ content: message, ephemeral: true });
				} else {
					return await i.reply({ content: `No card was found with that name.`, ephemeral: true });
				}
			} else {
				return sendCard(i, fetchedCard, ephemeral);
			}
		} catch (err) {
			await i.reply({
				ephemeral: true,
				content: 'An unexpected error has occurred when fetching this card',
			});
			console.error(err);
		}
	},
});

async function sendCard(i: CommandInteraction, card: Card, ephemeral: boolean) {
	return await i.reply({ content: card.uri, ephemeral: ephemeral });
}
