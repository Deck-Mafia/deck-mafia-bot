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

    const startTime = Date.now();

    try {
      // === PHASE 1: Fast check for exact public match ===
      const fetchedCard = await prisma.card.findFirst({
        where: { name: cardName.toLowerCase(), isPublic: true },
      });

      // If we found a card and we're still under 2.5s → reply immediately
      if (fetchedCard && Date.now() - startTime < 2500) {
        return await i.reply({
          content: fetchedCard.uri,
          ephemeral: makeCardEphemeral,
        });
      }

      // === PHASE 2: Heavy work (private cards, fuzzy search) ===
      const allPublicCardNames = await getAllCardNames();
      const allCards = [...allPublicCardNames];
      const privateCards = await getAllPrivateCards(i.user.id);

      const elapsed = Date.now() - startTime;

      // === PHASE 3: Decide: defer or reply? ===
      if (elapsed >= 2500) {
        // Too slow → defer with correct visibility
        await i.deferReply({ ephemeral: makeCardEphemeral });

        // Show warning in the deferred message
        await i.editReply({
          content: [
            `Warning: This command took longer than 3 seconds to process.`,
            `Using deferred response to avoid timeout.`,
            '',
            fetchedCard ? fetchedCard.uri : 'Processing...',
          ].join('\n'),
        });
      }

      // === PHASE 4: Handle no card found ===
      if (!fetchedCard) {
        if (privateCards[cardName]) {
          const content = privateCards[cardName].uri;
          if (elapsed < 2500) {
            return await i.reply({ content, ephemeral: makeCardEphemeral });
          } else {
            return await i.followUp({ content, ephemeral: makeCardEphemeral });
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

        // Always ephemeral suggestion
        if (elapsed < 2500) {
          return await i.reply({ content: message, ephemeral: true });
        } else {
          return await i.followUp({ content: message, ephemeral: true });
        }
      }

      // === PHASE 5: Public card found (after heavy work) ===
      if (elapsed < 2500) {
        return await i.reply({
          content: fetchedCard!.uri,
          ephemeral: makeCardEphemeral,
        });
      } else {
        return await i.followUp({
          content: fetchedCard!.uri,
          ephemeral: makeCardEphemeral,
        });
      }

    } catch (err) {
      console.error('Error in /view command:', err);

      const elapsed = Date.now() - startTime;

      if (elapsed < 2500) {
        return await i.reply({
          content: 'An unexpected error occurred while fetching this card.',
          ephemeral: false,
        });
      } else {
        // If deferred, edit the public message
        if (i.deferred) {
          return await i.editReply({
            content: 'An unexpected error occurred while fetching this card.',
          });
        } else {
          return await i.reply({
            content: 'An unexpected error occurred while fetching this card.',
            ephemeral: false,
          });
        }
      }
    }
  },
});