import { CommandInteraction, SlashCommandBuilder, User } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';

const amountOfCards = 19;

const c = new SlashCommandBuilder();
c.setName('give');
c.setDescription('Give a player a card to their inventory.');

c.addUserOption((i) => i.setName('user').setDescription('User you want to add a card for').setRequired(true));
c.addStringOption((i) => i.setName('card').setDescription('Name of the card').setRequired(true));

function addCards(amount: number) {
	for (let i = 0; i < amount; i++) {
		let name = `card_${i + 1}`;
		c.addStringOption((i) => i.setName(name).setDescription('Name of an additional card').setRequired(false));
	}
}

addCards(amountOfCards);

async function getAllCardNames() {
	const cards = await prisma.card.findMany({
		where: {},
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

async function fetchCardData(i: CommandInteraction, cardName: string, user: User) {
	const fetchedCard = await prisma.card.findFirst({
		where: {
			name: cardName.toLowerCase(),
		},
	});

	if (!fetchedCard) {
		const allCardNames = await getAllCardNames();
		if (allCardNames.length > 0) {
			const closestCardName = await getClosestCardName(cardName, allCardNames);
			await i.followUp({ content: `No card was found with that name. Did you mean \`${closestCardName.bestMatch.target}\`?`, ephemeral: true });
		} else {
			await i.followUp({ content: `No card was found with that name.`, ephemeral: true });
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

		await i.followUp({ content: `\`${cardName}\` added to ${user.username}` });
	}
}

export default newSlashCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const cardName = i.options.get('card', true).value as string;
		const user = i.options.getUser('user', true);
		let additionalCardNames: string[] = [];
		for (let ind = 0; ind < amountOfCards; ind++) {
			let name = `card_${ind + 1}`;
			let result = i.options.get(name, false);
			if (result) {
				if (result.value) {
					additionalCardNames.push(result.value as string);
				}
			}
		}

		try {
			await i.reply({ content: `Adding \`${additionalCardNames.length + 1}\` cards to \`${user.username}\`` });
			await fetchCardData(i, cardName, user);
			for (let index = 0; index < additionalCardNames.length; index++) {
				await fetchCardData(i, additionalCardNames[index], user);
			}
		} catch (err) {
			await i.reply({
				ephemeral: true,
				content: 'An unexpected error has occurred when saving this/these card/s',
			});
			console.error(err);
		}
	},
});
