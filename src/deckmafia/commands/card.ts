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
    // Fetch all cards owned by the user (including public/private). The targeted exact lookup
    // earlier is restricted to isPublic:false for speed; the full list can be heavier and
    // should include all owned cards for comprehensive suggestions.
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

// Configuration from environment (with sensible defaults):
// - VIEW_DEBUG: when 'true' enables special debug tokens that simulate errors.
// - VIEW_TIMEOUT_MS: exact-lookup timeout (ms) before deferring. Default 2500ms.
const VIEW_DEBUG = (() => {
  const v = process.env.VIEW_DEBUG;
  if (typeof v === 'string') {
    const norm = v.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(norm);
  }
  return Boolean(v);
})();
const VIEW_TIMEOUT_MS = parseInt(process.env.VIEW_TIMEOUT_MS ?? '2500', 10);


function removeTrailingQuestion(str: string): string {
  return str.replace(/\?$/, '');
}
const cardNotFound = `No card of that name found in public database or user's cards. Searching for close matches...`
// === DEBUG CONFIG ===
// Show processing time only when debug is enabled
const SHOW_PROCESSING_TIME = VIEW_DEBUG;

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    const cardName = i.options.getString('name', true);
    const userWantsEphemeral = i.options.getBoolean('hidden') ?? true;

    const startTime = performance.now(); // High-precision timer
    let deferred = false;

    // safe wrappers to avoid throwing on Unknown interaction and to keep single reply semantics
    const safeReply = async (payload: { content: string; ephemeral?: boolean }) => {
      try {
        if (i.deferred) {
          // If already deferred, edit the reply instead of replying
          return await i.editReply({ content: payload.content });
        }
        return await i.reply({ content: payload.content, ephemeral: payload.ephemeral });
      } catch (e: any) {
        console.error('Failed to reply (safeReply):', e?.message ?? e);
        // swallow DiscordAPIError to avoid crashing the process
        return null;
      }
    };

    const safeFollowUp = async (payload: { content: string; ephemeral?: boolean }) => {
      try {
        return await i.followUp({ content: payload.content, ephemeral: payload.ephemeral });
      } catch (e: any) {
        console.error('Failed to followUp (safeFollowUp):', e?.message ?? e);
        return null;
      }
    };

    const safeEdit = async (content: string) => {
      try {
        return await i.editReply({ content });
      } catch (e: any) {
        console.error('Failed to editReply (safeEdit):', e?.message ?? e);
        return null;
      }
    };

    try {
      const cardNameLower = cardName.toLowerCase();

      // Debug triggers: special inputs to simulate errors
      // Only active when VIEW_DEBUG is true (set VIEW_DEBUG in env)
      const PREDEF_TOKEN = '__err_predef';
      const POSTDEF_TOKEN = '__err_postdef';
      if (VIEW_DEBUG && cardNameLower === PREDEF_TOKEN) {
        // simulate an error before any deferral/acknowledgement
        throw new Error('Simulated pre-deferral error');
      }

  /*
   * Exact vs Heavy split:
   * - Exact lookups: targeted findFirst queries for public card and private ownership. These are designed
   *   to be minimal and fast (select only necessary fields) so the common exact-match path can reply
   *   immediately without deferring.
   * - Heavy work: fetching all public card names and the full private card list (for fuzzy suggestions)
   *   can be slow for large datasets. We delay this until after we've acknowledged the interaction
   *   (via deferReply) to avoid hitting Discord's interaction timeout (~3s). This keeps the user-facing
   *   exact-match experience fast while still providing suggestions when needed.
   */
  // Start only the fast lookups first: public exact and private exact (don't await yet)
  // Use targeted queries (select minimal fields) so these are fast even with large datasets.
      const publicExactPromise = prisma.card.findFirst({
        where: { name: cardNameLower, isPublic: true },
        select: { uri: true, name: true },
      });
      // Private exact lookup: restrict to non-public cards owned by this user
      const privateExactPromise = prisma.card.findFirst({
        where: {
          name: cardNameLower,
          isPublic: false,
          ownedCards: { some: { inventory: { discordId: i.user.id } } },
        },
        select: { uri: true, name: true },
      });

      // Wait for exact lookups but only up to a short timeout to avoid interaction expiry
      const EXACT_TIMEOUT_MS = 2500; // 3s Discord timeout with ~0.5s buffer
      const exactPromise = Promise.all([publicExactPromise, privateExactPromise]);
      const timeoutPromise = new Promise((res) => setTimeout(() => res('timeout'), EXACT_TIMEOUT_MS));
      const raced = (await Promise.race([exactPromise, timeoutPromise])) as any;
      let fetchedPublic: any | null = null;
      let fetchedPrivateExact: any | null = null;

      if (raced === 'timeout') {
        // exact checks are still running -> defer now to acknowledge interaction
        await i.deferReply({ ephemeral: true });
        deferred = true;
        // await remaining exact results
        [fetchedPublic, fetchedPrivateExact] = await exactPromise;
      } else {
        // exactPromise finished within timeout
        [fetchedPublic, fetchedPrivateExact] = raced as [any, any];
      }

      const elapsed = performance.now() - startTime;

      // FIRST: exact-match lookups (fast). If we already deferred above, use editReply via safeEdit
      // If the user has the private exact card, return it immediately
      if (fetchedPrivateExact) {
        const timeMsg = getTimeMessage(performance.now() - startTime);
        const content = `${fetchedPrivateExact.uri}\n${timeMsg}`;
        if (deferred) return await safeEdit(content);
        return await safeReply({ content, ephemeral: userWantsEphemeral });
      }

      // If a public exact card exists, return it immediately
      if (fetchedPublic) {
        const timeMsg = getTimeMessage(performance.now() - startTime);
        const content = `${fetchedPublic.uri}\n${timeMsg}`;
        if (deferred) return await safeEdit(content);
        return await safeReply({ content, ephemeral: userWantsEphemeral });
      }

      // NOTHING exact matched: Always defer/acknowledge before doing heavier fuzzy work.
      // This guarantees we never reply and then later defer (which is invalid).
      if (!deferred) {
        await i.deferReply({ ephemeral: true });
        deferred = true;
      }
      // after deferral, optionally simulate an error (for testing post-defer error handling)
      if (VIEW_DEBUG && cardNameLower === POSTDEF_TOKEN) {
        throw new Error('Simulated post-deferral error');
      }
      const timeMsgStart = getTimeMessage(elapsed);
      // show a short processing message in the deferred reply while we compute suggestions
      await safeEdit([`No card of that name found in public database or user's cards. Searching for close matches...`, ``, `${timeMsgStart}`].join('\n'));

  // Now perform the heavier fetching for suggestions (public names + merge private names)
  const allPublicCardNames = await getAllCardNames();
  // fetch full private cards list for suggestions (this can be heavier)
  const allPrivateCards = await getAllPrivateCards(i.user.id);
  const allCardsSet = new Set<string>(allPublicCardNames);
  Object.values(allPrivateCards).forEach((card) => allCardsSet.add(card.name));
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
      const fullMessage = `${cardNotFound}\n${message}\n${timeMsg}`;
      // We have already deferred and shown a "Card Not Found" message — add a new line and send suggestions.
      return await safeEdit({fullMessage});
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
