import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';
import { Card } from '.prisma/client';
import { send } from 'process';

const c = new SlashCommandBuilder();
c.setName('card');
c.setDescription('View a public card');
c.addStringOption((o) => o.setName('name').setDescription('Name of the card').setRequired(true));
c.addBooleanOption((i) => i.setName('hidden').setDescription('Do you wanna make this only visible to you? Default is no').setRequired(true));

async function getAllCardNames() {
	const cards = await prisma.card.findMany({
		where: {
			OR: { isPublic: true },
		},
		include: {
			ownedCards: true,
		},
	});

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
					isPublic: true,
				},
			});

			if (!fetchedCard) {
				const allPublicCardNames = await getAllCardNames();
				const allCards: string[] = allPublicCardNames;
				const privateCards = await getAllPrivateCards(i.user.id);
				if (privateCards[cardName]) {
					return sendCard(i, privateCards[cardName], ephemeral);
				} else {
					const privateKeys = Object.keys(privateCards);
					privateKeys.forEach((key) => {
						if (!allCards.includes(key)) allCards.push(key);
					});

					if (allCards.length > 0) {
						const closestCardName = await getClosestCardName(cardName, allCards);
						const closestPublicCardName = await getClosestCardName(cardName, allPublicCardNames);
						let message = `No card was found with that name. If you're referring to a public card, did you mean \`${closestPublicCardName.bestMatch.target}\`?`;
						if (closestPublicCardName.bestMatch.target != closestCardName.bestMatch.target) message += `\nIf you were trying to find a privately owned/hidden one, did you mean${closestCardName.bestMatch.target} `;
						return await i.reply({ content: message, ephemeral: true });
					} else {
						return await i.reply({ content: `No card was found with that name.`, ephemeral: true });
					}
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
