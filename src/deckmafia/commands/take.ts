import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder, User } from 'discord.js';
import { MessageFlags } from "discord.js";
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';

const amountOfCards = 19;

const c = new SlashCommandBuilder();
c.setName('take');
c.setDescription('Remove a card from a players inventory.');

c.addUserOption((i) => i.setName('user').setDescription('User you want to remove a card from').setRequired(true));
c.addStringOption((i) => i.setName('card').setDescription('Name of the card').setRequired(true));

function addCards(amount: number) {
	for (let i = 0; i < amount; i++) {
		let name = `card_${i + 1}`;
		c.addStringOption((i) => i.setName(name).setDescription('Name of an additional card to remove').setRequired(false));
	}
}

addCards(amountOfCards);

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

async function removeCard(i: ChatInputCommandInteraction, cardName: string, user: User) {
	// Fragment fallback: use FragmentBalance instead of OwnedCard
	if (cardName.toLowerCase() === 'fragment') {
		const balance = await prisma.fragmentBalance.findUnique({
			where: { discordId: user.id },
			select: { amount: true },
		});

		const currentAmount = balance?.amount ?? 0;
		if (currentAmount === 0) {
			return i.followUp({ content: `\`${user.username}\` has no Fragments.`, flags: MessageFlags.Ephemeral });
		}

		if (currentAmount === 1) {
			await prisma.fragmentBalance.delete({ where: { discordId: user.id } });
		} else {
			await prisma.fragmentBalance.update({
				where: { discordId: user.id },
				data: { amount: { decrement: 1 } },
			});
		}
		await i.followUp({ content: `\`fragment\` removed from ${user.username} (Fragment balance)` });
		return;
	}

	const fetchedCard = await prisma.card.findFirst({
		where: {
			name: cardName.toLowerCase(),
		},
	});

	if (!fetchedCard) {
		const allCardNames = await getAllCardNames();
		if (allCardNames.length > 0) {
			const closestCardName = await getClosestCardName(cardName, allCardNames);
			await i.followUp({ content: `No public card was found with that name. Did you mean \`${closestCardName.bestMatch.target}\`?\nIf the card you want is private, please use \`/privatecard\``, flags: MessageFlags.Ephemeral });
		} else {
			await i.followUp({ content: `No public card was found with that name.`, flags: MessageFlags.Ephemeral });
		}
	} else {
		let inventory = await prisma.inventory.findUnique({ where: { discordId: user.id } });
		if (!inventory) inventory = await prisma.inventory.create({ data: { discordId: user.id } });
		if (!inventory) return i.followUp({ content: 'An error creating a new inventory has occurred' });

		const cardToDelete = await prisma.ownedCard.findFirst({
			where: {
				inventory: { discordId: user.id },
				card: { name: cardName },
			},
		});

		if (!cardToDelete) return await i.followUp({ content: `User does not own this card.`, flags: MessageFlags.Ephemeral });

		await prisma.ownedCard.delete({
			where: {
				id: cardToDelete.id,
			},
		});

		await i.followUp({ content: `\`${cardName}\` removed from ${user.username}` });
	}
}

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
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
			await i.reply(`Attempting to remove \`${additionalCardNames.length + 1}\` card/s`);
			await removeCard(i, cardName, user);
			for (let index = 0; index < additionalCardNames.length; index++) {
				await removeCard(i, additionalCardNames[index], user);
			}
		} catch (err) {
			await i.reply({
				flags: MessageFlags.Ephemeral,
				content: 'An unexpected error has occurred when fetching this card',
			});
			console.error(err);
		}
	},
});
