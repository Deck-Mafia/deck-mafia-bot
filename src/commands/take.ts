import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '..';
import { newSlashCommand, SlashCommand } from '../structures/SlashCommand';
import string from 'string-similarity';

const c = new SlashCommandBuilder();
c.setName('take');
c.setDescription('Remove a card from a players inventory.');

c.addUserOption((i) => i.setName('user').setDescription('User you want to remove a card from').setRequired(true));
c.addStringOption((i) => i.setName('card').setDescription('Name of the card').setRequired(true));
c.addIntegerOption((i) => i.setName('amount').setDescription('Number of these cards to remove from the inventory').setRequired(true));

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
					isPublic: true,
				},
			});

			if (!fetchedCard) {
				const allCardNames = await getAllCardNames();
				if (allCardNames.length > 0) {
					const closestCardName = await getClosestCardName(cardName, allCardNames);
					await i.reply({ content: `No public card was found with that name. Did you mean \`${closestCardName.bestMatch.target}\`?\nIf the card you want is private, please use \`/privatecard\``, ephemeral: true });
				} else {
					await i.reply({ content: `No public card was found with that name.`, ephemeral: true });
				}
			} else {
				let inventory = await prisma.inventory.findUnique({ where: { discordId: user.id } });
				if (!inventory) inventory = await prisma.inventory.create({ data: { discordId: user.id } });
				if (!inventory) return i.reply({ content: 'An error creating a new inventory has occurred' });

				const cardToDelete = await prisma.ownedCard.findFirst({
					where: {
						inventory: { discordId: user.id },
						card: { name: cardName },
					},
				});

				if (!cardToDelete) return await i.reply({ content: `User does not own this card.`, ephemeral: true });

				await prisma.ownedCard.delete({
					where: {
						id: cardToDelete.id,
					},
				});

				await i.reply({ content: `\`${cardName}\` removed from ${user.username}` });
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
