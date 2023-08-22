import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';

const c = new SlashCommandBuilder();
c.setName('peek');
c.setDescription('See what cards a player has in their inventory.');
c.addUserOption((i) => i.setName('user').setDescription('User you want to add a card for').setRequired(true));

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
	async execute(i: ChatInputCommandInteraction) {
		const user = i.options.getUser('user', true);

		try {
			const inventory = await prisma.inventory.findUnique({
				where: {
					discordId: user.id,
				},
				include: {
					ownedCards: {
						include: {
							card: true,
						},
					},
				},
			});

			if (!inventory) return i.reply({ content: 'User does not have an inventory. To make one, use the `/give` command.' });

			let value = `\`\`\`diff\nINVENTORY FOR ${user.username.toUpperCase()}\n- ${inventory.ownedCards.length} CARDS TOTAL\n\n`;

			inventory.ownedCards.forEach((ownedCard) => {
				if (ownedCard.card) value += `+ ${ownedCard.card.name}\n`;
			});

			value += '```';

			await i.reply({ content: value });
		} catch (err) {
			await i.reply({
				ephemeral: true,
				content: 'An unexpected error has occurred when fetching this card',
			});
			console.error(err);
		}
	},
});
