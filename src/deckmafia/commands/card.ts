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
    const userWantsEphemeral = i.options.getBoolean('hidden') ?? true;

    const startTime = Date.now();
    let deferred = false;

    try {
      // PHASE 1: Fast public lookup
      const fetchedCard = await prisma.card.findFirst({
        where: { name: cardName.toLowerCase(), isPublic: true },
      });

      const elapsed = Date.now() - startTime;

      // Fast path: reply immediately
      if (fetchedCard && elapsed < 2500) {
        return await i.reply({
          content: fetchedCard.uri,
          ephemeral: userWantsEphemeral,
        });
      }

      // Too slow → defer with EPHEMERAL
      if (!deferred && elapsed >= 2500) {
        await i.deferReply({ ephemeral: true });
        deferred = true;

        await i.editReply({
          content: [
            'Warning: This took longer than 3 seconds.',
            'Response is now **ephemeral only** due to deferral.',
            '',
            'Processing...',
          ].join('\n'),
        });
      }

      // PHASE 2: Heavy work
      const allPublicCardNames = await getAllCardNames();
      const allCards = [...allPublicCardNames];
      const privateCards = await getAllPrivateCards(i.user.id);

      // Private card found
      if (privateCards[cardName]) {
        const content = privateCards[cardName].uri;
        if (deferred) {
          return await i.editReply({ content });
        } else {
          return await i.reply({ content, ephemeral: userWantsEphemeral });
        }
      }

      // Build suggestion
      Object.keys(privateCards).forEach((key) => {
        if (!allCards.includes(key)) allCards.push(key);
      });

      let message = 'No card was found with that name.';
      if (allCards.length > 0) {
        const { bestMatch: c1 } = await getClosestCardName(cardName, allCards);
        const { bestMatch: c2 } = await getClosestCardName(cardName, allPublicCardNames);
        message = `Did you mean \`${c2.target}\``;
        if (c1.target !== c2.target) {
          message = removeTrailingQuestion(message) + ` or \`${c1.target}\` (private)?`;
        }
      }

      // Send suggestion (always ephemeral)
      if (deferred) {
        return await i.followUp({ content: message, ephemeral: true });
      } else {
        return await i.reply({ content: message, ephemeral: true });
      }

      // Public card found (after heavy work)
      if (fetchedCard) {
        if (deferred) {
          return await i.editReply({ content: fetchedCard!.uri }); // ← ! here
        } else {
          return await i.reply({ content: fetchedCard!.uri, ephemeral: userWantsEphemeral });
        }
      }

    } catch (err) {
      console.error('Error in /view command:', err);

      if (deferred) {
        return await i.editReply({
          content: 'An unexpected error occurred while fetching this card.',
        });
      } else {
        return await i.reply({
          content: 'An unexpected error occurred while fetching this card. If you are seeing this message, please screenshot it and send it to Cybeast along with, preferably, a timestamp.',
          ephemeral: true,
        });
      }
    }
  },
});