import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '..';
import { newSlashCommand, SlashCommand } from '../structures/SlashCommand';
import string from 'string-similarity';

const c = new SlashCommandBuilder();
c.setName('give');
c.setDescription('Give a player a card to their inventory.');

c.addUserOption((i) => i.setName('user').setDescription('User you want to add a card for').setRequired(true));
c.addStringOption((i) => i.setName('card').setDescription('Name of the card').setRequired(true));

async function getAllCardNames() {
	const cards = await prisma.card.findMany({
		where: {
			isPublic: true,
		},
		select: {
			name: true,
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

export default newSlashCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const cardName = i.options.get('card', true).value as string;
		const user = i.options.getUser('user', true);

		try {
			const fetchedCard = await prisma.card.findFirst({
				where: {
					name: cardName.toLowerCase(),
				},
			});

			if (!fetchedCard) {
				const allCardNames = await getAllCardNames();
				if (allCardNames.length > 0) {
					const closestCardName = await getClosestCardName(cardName, allCardNames);
					await i.reply({ content: `No card was found with that name. Did you mean \`${closestCardName.bestMatch.target}\`?`, ephemeral: true });
				} else {
					await i.reply({ content: `No card was found with that name.`, ephemeral: true });
				}
			} else {
				const newCard = await prisma.ownedCard.create({
					data: {
						card: {
							connect: {
								id: fetchedCard.id,
							},
						},
						inventory: {
							connectOrCreate: {
								where: {
									discordId: user.id,
								},
								create: {
									discordId: user.id,
								},
							},
						},
					},
				});

				await i.reply({ content: `\`${cardName}\` added to ${user.username}` });
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
