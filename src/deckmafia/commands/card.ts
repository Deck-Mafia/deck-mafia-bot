import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';
import { Card } from '.prisma/client';
import { send } from 'process';

const c = new SlashCommandBuilder();
c.setName('view');
c.setDescription('View either a card in the public database, or a card you own.');
c.addStringOption((o) => o.setName('name').setDescription('Name of the card').setRequired(true));
c.addBooleanOption((i) => i.setName('hidden').setDescription('Do you wanna make this only visible to you? (Defaults to true)').setRequired(false));

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
function removeTrailingQuestion(str: string): string {
  return str.replace(/\?$/, '');
}

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    const cardName = i.options.getString('name', true);
    const makeCardEphemeral = i.options.getBoolean('hidden') ?? true;

    await i.deferReply();

    try {
      const fetchedCard = await prisma.card.findFirst({
        where: { name: cardName.toLowerCase(), isPublic: true },
      });

      if (!fetchedCard) {
        const allPublicCardNames = await getAllCardNames();
        const allCards = [...allPublicCardNames];
        const privateCards = await getAllPrivateCards(i.user.id);

        if (privateCards[cardName]) {
          return sendCard(i, privateCards[cardName], makeCardEphemeral);
        }

        Object.keys(privateCards).forEach((key) => {
          if (!allCards.includes(key)) allCards.push(key);
        });

        let message = 'No card was found with that name.';
        if (allCards.length > 0) {
          const { bestMatch: c1 } = await getClosestCardName(cardName, allCards);
          const { bestMatch: c2 } = await getClosestCardName(cardName, allPublicCardNames);

          // Fixed: closed backticks
          message = `Did you mean \`${c2.target}\``;

          if (c1.target !== c2.target) {
            message = removeTrailingQuestion(message) + ` or \`${c1.target}\` (private)?`;
          }
        }

        return await i.followUp({
          content: message,
          ephemeral: true,
        });
      }

      return sendCard(i, fetchedCard, makeCardEphemeral);

    } catch (err) {
      console.error('Error in /view command:', err);
      return await i.editReply({
        content: 'An unexpected error occurred while fetching this card.',
      });
    }
  },
});

async function sendCard(
  i: ChatInputCommandInteraction,
  card: Card,
  ephemeral: boolean
) {
  await i.followUp({
    content: card.uri,
    ephemeral,
  });
}
