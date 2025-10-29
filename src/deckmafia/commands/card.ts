import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';
import stringSimilarity from 'string-similarity';
import { Card } from '.prisma/client';
import { send } from 'process';

const c = new SlashCommandBuilder();
c.setName('view');
c.setDescription('View either a card in the public database, or a card you own.');
c.addStringOption((o) => o.setName('name').setDescription('Name of the card').setRequired(true));
c.addBooleanOption((i) => i.setName('hidden').setDescription('Do you wanna make this only visible to you? (Defaults to true)').setRequired(false));

async function getAllCardNames() {
  const cards = await prisma.card.findMany({ where: { isPublic: true } });
  return cards.map((c) => c.name);
}

async function getClosestCardName(cardName: string, list: string[]) {
  const result = stringSimilarity.findBestMatch(cardName, list);
  // Log only the query and the top candidates to avoid excessive output
  const topN = 5;
  const top = [...result.ratings]
    .sort((a: any, b: any) => b.rating - a.rating)
    .slice(0, topN)
    .map((r: any) => ({ target: r.target, rating: r.rating }));
  console.log({ query: cardName, top });
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
    allPrivateCards[card.name.toLowerCase()] = card; // lowercase key for lookups
  });
  return allPrivateCards;
}

function removeTrailingQuestion(str: string): string {
  return str.replace(/\?$/, '');
}

// === DEBUG CONFIG ===
const SHOW_PROCESSING_TIME = true; // Set to false to disable

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    const cardName = i.options.getString('name', true);
    const userWantsEphemeral = i.options.getBoolean('hidden') ?? true;

    const startTime = performance.now(); // High-precision timer
    let deferred = false;

    try {
      const cardNameLower = cardName.toLowerCase();

      // Start only the fast lookups first: public exact and private exact
      const [fetchedCard, privateCards] = await Promise.all([
        prisma.card.findFirst({ where: { name: cardNameLower, isPublic: true } }),
        getAllPrivateCards(i.user.id),
      ]);

      const elapsed = performance.now() - startTime;

      // FIRST: exact-match lookups (fast). Do them before deferring.
      if (privateCards[cardNameLower]) {
        const timeMsg = getTimeMessage(performance.now() - startTime);
        const content = `${privateCards[cardNameLower].uri}\n${timeMsg}`;
        return await i.reply({ content, ephemeral: userWantsEphemeral });
      }

      if (fetchedCard) {
        const timeMsg = getTimeMessage(performance.now() - startTime);
        const content = `${fetchedCard.uri}\n${timeMsg}`;
        return await i.reply({ content, ephemeral: userWantsEphemeral });
      }

      // NOTHING exact matched: defer now (once) and continue with heavier fuzzy work
      await i.deferReply({ ephemeral: true });
      deferred = true;
      const timeMsgStart = getTimeMessage(elapsed);
      await i.editReply({ content: [`Processing...`, ``, `${timeMsgStart}`].join('\n') });

      // Now perform the heavier fetching for suggestions (public names + merge private names)
      const allPublicCardNames = await getAllCardNames();
      const allCardsSet = new Set<string>(allPublicCardNames);
      Object.values(privateCards).forEach((card) => allCardsSet.add(card.name));
      const allCards = Array.from(allCardsSet);

      // No direct hit -> suggestions
      let message = 'No card was found with that name.';
      if (allCards.length > 0) {
        // DB contents are lowercase; compare using the lowercase query for best results
        const { bestMatch: c1 } = await getClosestCardName(cardNameLower, allCards);
        const { bestMatch: c2 } = await getClosestCardName(cardNameLower, allPublicCardNames);
        message = `Did you mean \`${c2.target}\`?`;
        if (c1.target !== c2.target) {
          message = removeTrailingQuestion(message) + ` or \`${c1.target}\` (private)?`;
        }
      }

      const timeMsg = getTimeMessage(performance.now() - startTime);
      const fullMessage = `${message}\n${timeMsg}`;
      return await i.editReply({ content: fullMessage });
    } catch (err) {
      console.error('Error in /view command:', err);
      const timeMsg = getTimeMessage(performance.now() - startTime);
      const content = `An unexpected error occurred while fetching this card.\n${timeMsg}`;
      if (deferred) return await i.editReply({ content });
      return await i.reply({ content, ephemeral: false });
    }
  },
});

/**
 * Format elapsed time in ms
 */
function getTimeMessage(elapsed: number): string {
  if (!SHOW_PROCESSING_TIME) return '';
  const ms = elapsed.toFixed(0);
  return `*Processed in ${ms}ms*`;
}