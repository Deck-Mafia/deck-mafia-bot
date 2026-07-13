import {
	ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextChannel,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';

const BOOSTER_PACK_NAME = 'booster pack';
const COMMON_ITEM = 'regular bullet';
const FALLBACK_CARD = 'DEBUG';

// Rarities that should never be pulled from packs
const EXCLUDED_RARITIES = [-1, -99];

// Pullable rarities
const PULLABLE_RARITIES = [0, 3, 4, 5, 6];

const c = new SlashCommandBuilder();
c.setName('openpack');
c.setDescription('Open a Booster Pack for a user (Admin only)');
c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
c.addUserOption((o) =>
	o.setName('user').setDescription('The user whose booster pack will be opened').setRequired(true)
);
c.addBooleanOption((o) =>
	o
		.setName('extra')
		.setDescription('Pull 4 standard slots instead of 3 (5 cards total instead of 4)')
		.setRequired(false)
);

/**
 * Roll the rarity for a single card slot.
 * Guaranteed slots have better odds than standard slots.
 */
function getRarityRoll(isGuaranteed: boolean): number {
	const roll = Math.random() * 100;
	if (isGuaranteed) {
		if (roll < 85) return 4;
		if (roll < 97) return 5;
		return 6;
	} else {
		if (roll < 2) return 0;
		if (roll < 86) return 3;
		if (roll < 94) return 4;
		if (roll < 99) return 5;
		return 6;
	}
}

/**
 * Pick a card by rarity from the pool.
 * For rarity 0, there's an 85% gatekeeper chance to return the common item.
 * Falls back to the DEBUG card if the pool is empty.
 */
function getCardByRarity(
	rarity: number,
	poolByRarity: Map<number, { id: string; name: string; uri: string }[]>
): { id: string; name: string; uri: string } | null {
	// Gatekeeper for rarity 0
	if (rarity === 0) {
		if (Math.random() < 0.85) {
			// Find the common item in the full pool
			const commonPool = poolByRarity.get(0) ?? [];
			const common = commonPool.find((c) => c.name === COMMON_ITEM);
			if (common) return common;
			// If common item isn't in rarity 0, try finding it by name across all pools
			for (const [, cards] of poolByRarity) {
				const found = cards.find((c) => c.name === COMMON_ITEM);
				if (found) return found;
			}
			return null;
		}
	}

	// Get the pool for this rarity, excluding the common item
	const pool = (poolByRarity.get(rarity) ?? []).filter((c) => c.name !== COMMON_ITEM);

	if (pool.length === 0) {
		// Fallback: try to find the DEBUG fallback card
		for (const [, cards] of poolByRarity) {
			const found = cards.find((c) => c.name === FALLBACK_CARD);
			if (found) return found;
		}
		return null;
	}

	return pool[Math.floor(Math.random() * pool.length)];
}

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;

		// Admin permission check
		//@ts-ignore
		const member = i.guild.members.cache.get(i.user.id);
		if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return i.reply({
				content: 'You must be an administrator to use this command.',
				flags: MessageFlags.Ephemeral,
			});
		}

		const targetUser = i.options.getUser('user', true);
		const extraSlot = i.options.getBoolean('extra', false) ?? false;
		const standardSlots = extraSlot ? 4 : 3;

		await i.deferReply();

		try {
			// 1. Fetch the target user's inventory and find booster packs
			const inventory = await prisma.inventory.findUnique({
				where: { discordId: targetUser.id },
				include: {
					ownedCards: {
						where: {
							card: {
								name: BOOSTER_PACK_NAME,
							},
						},
						include: {
							card: true,
						},
					},
				},
			});

			if (!inventory || inventory.ownedCards.length === 0) {
				return i.editReply({
					content: `<@${targetUser.id}> does not have any Booster Packs in their inventory.`,
				});
			}

			// 2. Consume one booster pack
			const boosterPack = inventory.ownedCards[0];
			await prisma.ownedCard.delete({
				where: { id: boosterPack.id },
			});

			// 3. Fetch all pullable cards (public only) and group by rarity
			const allPullableCards = await prisma.card.findMany({
				where: {
					rarity: { in: PULLABLE_RARITIES },
					isPublic: true,
				},
				select: { id: true, name: true, uri: true, rarity: true },
			});

			const poolByRarity = new Map<number, { id: string; name: string; uri: string }[]>();
			for (const card of allPullableCards) {
				const r = card.rarity ?? -99; // Treat null rarity as not processed
				if (EXCLUDED_RARITIES.includes(r)) continue;
				if (!poolByRarity.has(r)) poolByRarity.set(r, []);
				poolByRarity.get(r)!.push({ id: card.id, name: card.name, uri: card.uri });
			}

			// 4. Run the pack draw logic
			const drawnCards: { name: string; uri: string; rarity: number }[] = [];

			for (let slot = 0; slot < standardSlots + 1; slot++) {
				const isGuaranteed = slot === standardSlots;
				const rarity = getRarityRoll(isGuaranteed);
				const card = getCardByRarity(rarity, poolByRarity);

				if (card) {
					drawnCards.push({ name: card.name, uri: card.uri, rarity });
				} else {
					// Ultimate fallback — shouldn't happen but just in case
					drawnCards.push({ name: FALLBACK_CARD, uri: '', rarity: 0 });
				}
			}

			// 5. Add drawn cards to the target user's inventory
			for (const drawn of drawnCards) {
				const fetchedCard = await prisma.card.findFirst({
					where: { name: drawn.name },
				});

				if (fetchedCard) {
					await prisma.ownedCard.create({
						data: {
							card: {
								connect: { id: fetchedCard.id },
							},
							inventory: {
								connectOrCreate: {
									where: { discordId: targetUser.id },
									create: { discordId: targetUser.id },
								},
							},
						},
					});
				}
			}

			// 6. Post results to the channel
			const channel = i.channel;
			if (channel && channel.isTextBased() && !channel.isDMBased()) {
				for (let index = 0; index < drawnCards.length; index++) {
					const card = drawnCards[index];
					if (card.uri) {
						await (channel as TextChannel).send({
							content: `[${index + 1}/${drawnCards.length}] <@${targetUser.id}> pulled:\n${card.uri}`,
						});
					}
				}
			}

			// 7. Build and send the summary embed
			const rarityLabels: Record<number, string> = {
				0: '0★ (Item)',
				3: '3★',
				4: '4★',
				5: '5★',
				6: '6★',
			};

			const embed = new EmbedBuilder();
			embed.setTitle('Booster Pack Opened');
			embed.setDescription(
				`<@${targetUser.id}> opened a Booster Pack and pulled ${drawnCards.length} cards!`
			);
			embed.setColor(0xf8f98e);
			embed.setThumbnail(i.guild.iconURL());

			const cardList = drawnCards
				.map(
					(card, idx) =>
						`**${idx + 1}.** \`${card.name}\` — ${rarityLabels[card.rarity] ?? `${card.rarity}★`}`
				)
				.join('\n');

			embed.addFields({ name: 'Cards Pulled', value: cardList });

			await i.editReply({ content: 'Pack opened successfully!', embeds: [embed] });
		} catch (err) {
			console.error('[OPENPACK ERROR]', err);
			await i.editReply({
				content: 'An error occurred while opening the booster pack.',
			});
		}
	},
});