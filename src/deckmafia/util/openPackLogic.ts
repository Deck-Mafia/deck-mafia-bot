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

// Chance that a pack containing a named "Wished Card" actually pulls that card.
const WISH_CHANCE = 0.3;

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
 * Validate a "Wished Card": it must exist, be public, and be pullable.
 * Throws a descriptive error otherwise (so the pack is never consumed).
 */
async function getPullableWishCard(
	wishedCardName: string
): Promise<{ name: string; uri: string; rarity: number }> {
	const card = await prisma.card.findFirst({
		where: { name: wishedCardName.toLowerCase() },
		select: { name: true, uri: true, rarity: true, isPublic: true },
	});

	if (!card) {
		throw new Error(
			`Wished card \`${wishedCardName}\` does not exist in the database. The pack was not opened.`
		);
	}
	if (!card.isPublic) {
		throw new Error(
			`Wished card \`${wishedCardName}\` must be public to be wishable. The pack was not opened.`
		);
	}
	if (card.rarity === null || card.rarity === undefined || !PULLABLE_RARITIES.includes(card.rarity)) {
		throw new Error(
			`Wished card \`${wishedCardName}\` must be pullable (rarity ${PULLABLE_RARITIES.join(', ')}★). The pack was not opened.`
		);
	}

	return { name: card.name, uri: card.uri, rarity: card.rarity };
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
	wishedCardName?: string,
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

	// 2. Fetch all pullable cards and group by rarity (read-only, outside transaction)
	const boosterPack = inventory.ownedCards[0];
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

	// 3. Run the pack draw logic (RNG — no DB writes)
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

	// Wished Card passive: when an admin names a wished card, there is a 30% chance it
	// replaces one of the NON-guaranteed slots (so it may be any rarity tier, e.g. a 3★).
	// The guaranteed last slot is never swapped. Validation runs before the DB transaction,
	// so a rejected wish leaves the pack unconsumed.
	let wishApplied = false;
	if (wishedCardName) {
		const wishCard = await getPullableWishCard(wishedCardName);
		if (Math.random() < WISH_CHANCE) {
			const targetSlot = Math.floor(Math.random() * standardSlots); // 0..standardSlots-1, never the guaranteed one
			drawnCards[targetSlot] = { name: wishCard.name, uri: wishCard.uri, rarity: wishCard.rarity };
			wishApplied = true;
		}
	}

	// 4. Pre-resolve card IDs from names (so the transaction only does writes)
	const drawnCardIds: { name: string; cardId: string }[] = [];
	for (const drawn of drawnCards) {
		const fetchedCard = await prisma.card.findFirst({
			where: { name: drawn.name },
			select: { id: true },
		});
		if (fetchedCard) {
			drawnCardIds.push({ name: drawn.name, cardId: fetchedCard.id });
		}
	}

	// 5. Atomically consume the booster pack AND grant all drawn cards in one transaction.
	//    If any write fails, the entire operation rolls back — no lost packs, no partial grants.
	await prisma.$transaction(async (tx) => {
		// Consume one booster pack
		await tx.ownedCard.delete({
			where: { id: boosterPack.id },
		});

		// Grant all drawn cards
		for (const { cardId } of drawnCardIds) {
			await tx.ownedCard.create({
				data: {
					card: { connect: { id: cardId } },
					inventory: {
						connectOrCreate: {
							where: { discordId: targetUserId },
							create: { discordId: targetUserId },
						},
					},
				},
			});
		}
	});

	// 6. Log the pack opening to file
	const rarityLabelsLog: Record<number, string> = {
		0: '0★ Item',
		3: '3★',
		4: '4★',
		5: '5★',
		6: '6★',
	};

	const targetTag = i.guild?.members.cache.get(targetUserId)?.user.tag ?? targetUserId;
	const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
	const lines: string[] = [];
	lines.push(`[${timestamp}] ${openerTag} opened a booster pack for ${targetTag} | Extra: ${extraSlot ? 'yes' : 'no'} | Channel:#${channelName}`);
	if (wishedCardName) {
		lines.push(`  Wish: ${wishedCardName} | Applied: ${wishApplied ? 'yes' : 'no'}`);
	}
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