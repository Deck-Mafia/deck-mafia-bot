import { ChatInputCommandInteraction } from 'discord.js';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { prisma } from '../..';

const LOG_FILE = '/home/botdev/rands/pack-openings.log';

function ensureLogDir() {
	const dir = '/home/botdev/rands';
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export const BOOSTER_PACK_NAME = 'booster pack';
const COMMON_ITEM = 'regular bullet';
const FALLBACK_CARD = 'DEBUG';

const EXCLUDED_RARITIES = [-1, -99];
const PULLABLE_RARITIES = [0, 3, 4, 5, 6];

export interface DrawnCard {
	name: string;
	uri: string;
	rarity: number;
}

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
 */
function getCardByRarity(
	rarity: number,
	poolByRarity: Map<number, { id: string; name: string; uri: string }[]>
): { id: string; name: string; uri: string } | null {
	if (rarity === 0) {
		if (Math.random() < 0.85) {
			const commonPool = poolByRarity.get(0) ?? [];
			const common = commonPool.find((c) => c.name === COMMON_ITEM);
			if (common) return common;
			for (const [, cards] of poolByRarity) {
				const found = cards.find((c) => c.name === COMMON_ITEM);
				if (found) return found;
			}
			return null;
		}
	}

	const pool = (poolByRarity.get(rarity) ?? []).filter((c) => c.name !== COMMON_ITEM);

	if (pool.length === 0) {
		for (const [, cards] of poolByRarity) {
			const found = cards.find((c) => c.name === FALLBACK_CARD);
			if (found) return found;
		}
		return null;
	}

	return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Check if a user has a booster pack in their inventory and consume one.
 * Returns null if no booster pack found, otherwise returns the drawn cards array.
 */
export async function processOpenPack(
	i: ChatInputCommandInteraction,
	targetUserId: string,
	openerTag: string,
	extraSlot: boolean,
	channelName: string,
): Promise<{ drawnCards: DrawnCard[] } | null> {
	// 1. Fetch the target user's inventory and find booster packs
	const inventory = await prisma.inventory.findUnique({
		where: { discordId: targetUserId },
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
		return null;
	}

	// 2. Consume one booster pack
	const boosterPack = inventory.ownedCards[0];
	await prisma.ownedCard.delete({
		where: { id: boosterPack.id },
	});

	// 3. Fetch all pullable cards and group by rarity
	const allPullableCards = await prisma.card.findMany({
		where: {
			rarity: { in: PULLABLE_RARITIES },
			isPublic: true,
		},
		select: { id: true, name: true, uri: true, rarity: true },
	});

	const poolByRarity = new Map<number, { id: string; name: string; uri: string }[]>();
	for (const card of allPullableCards) {
		const r = card.rarity ?? -99;
		if (EXCLUDED_RARITIES.includes(r)) continue;
		if (!poolByRarity.has(r)) poolByRarity.set(r, []);
		poolByRarity.get(r)!.push({ id: card.id, name: card.name, uri: card.uri });
	}

	// 4. Run the pack draw logic
	const standardSlots = extraSlot ? 4 : 3;
	const drawnCards: DrawnCard[] = [];

	for (let slot = 0; slot < standardSlots + 1; slot++) {
		const isGuaranteed = slot === standardSlots;
		const rarity = getRarityRoll(isGuaranteed);
		const card = getCardByRarity(rarity, poolByRarity);

		if (card) {
			drawnCards.push({ name: card.name, uri: card.uri, rarity });
		} else {
			drawnCards.push({ name: FALLBACK_CARD, uri: '', rarity: 0 });
		}
	}

	// 5. Add drawn cards to the target user's inventory (with refund on failure)
	try {
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
								where: { discordId: targetUserId },
								create: { discordId: targetUserId },
							},
						},
					},
				});
			}
		}
	} catch (cardAddError) {
		// Refund the booster pack
		await prisma.ownedCard.create({
			data: {
				card: { connect: { id: boosterPack.cardId! } },
				inventory: { connect: { id: boosterPack.inventoryId } },
			},
		});
		throw cardAddError;
	}

	// 6. Log the pack opening to file
	const rarityLabelsLog: Record<number, string> = {
		0: '0★ Item',
		3: '3★',
		4: '4★',
		5: '5★',
		6: '6★',
	};

	const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
	const lines: string[] = [];
	lines.push(`[${timestamp}] ${openerTag} opened a booster pack for ${targetUserId} | Extra: ${extraSlot ? 'yes' : 'no'} | Channel:#${channelName}`);
	for (let idx = 0; idx < drawnCards.length; idx++) {
		const card = drawnCards[idx];
		const label = rarityLabelsLog[card.rarity] ?? `${card.rarity}★`;
		lines.push(`  Slot ${idx + 1}: ${card.name} (${label})`);
	}
	lines.push('');

	ensureLogDir();
	appendFileSync(LOG_FILE, lines.join('\n'));

	return { drawnCards };
}