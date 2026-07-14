/**
 * Fragment Migration Script
 *
 * 1. Logs all existing fragment OwnedCard rows grouped by user to fragments.log
 * 2. Seeds the FragmentBalance model with each user's count
 * 3. Deletes all fragment OwnedCard rows
 *
 * Run before deploying the new /craft and /fragments code:
 *   npx ts-node src/migrateFragments.ts
 */

import 'dotenv/config';
import { appendFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const LOG_FILE = '/home/botdev/rands/fragments.log';
const prisma = new PrismaClient();

function log(msg: string) {
	const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
	const line = `[${timestamp}] ${msg}`;
	console.log(line);
	appendFileSync(LOG_FILE, line + '\n');
}

async function main() {
	log('=== FRAGMENT MIGRATION STARTED ===');

	// 1. Find the fragment card template
	const fragmentCard = await prisma.card.findFirst({
		where: { name: 'fragment' },
		select: { id: true },
	});

	if (!fragmentCard) {
		log('No fragment card found in database. Nothing to migrate.');
		log('=== FRAGMENT MIGRATION COMPLETE (no action taken) ===');
		await prisma.$disconnect();
		return;
	}

	log(`Fragment card ID: ${fragmentCard.id}`);

	// 2. Group all fragment OwnedCards by inventoryId and count them
	const fragmentGroups = await prisma.ownedCard.groupBy({
		by: ['inventoryId'],
		where: { cardId: fragmentCard.id },
		_count: { id: true },
		orderBy: { inventoryId: 'asc' },
	});

	const totalFragmentRows = fragmentGroups.reduce((sum, g) => sum + g._count.id, 0);
	log(`Found ${totalFragmentRows} fragment OwnedCard rows across ${fragmentGroups.length} user(s).`);

	if (fragmentGroups.length === 0) {
		log('No users have fragment cards. Nothing to migrate.');
		log('=== FRAGMENT MIGRATION COMPLETE (no action taken) ===');
		await prisma.$disconnect();
		return;
	}

	// 3. Resolve each inventory to a discordId and log the full list BEFORE modifying anything
	log('');
	log('--- USER FRAGMENT INVENTORY (backup log) ---');

	const userFragments: { discordId: string; amount: number }[] = [];

	for (const group of fragmentGroups) {
		const inventory = await prisma.inventory.findUnique({
			where: { id: group.inventoryId },
			select: { discordId: true },
		});

		if (!inventory) {
			log(`WARNING: Inventory ${group.inventoryId} has ${group._count.id} fragments but no longer exists. Skipping.`);
			continue;
		}

		log(`  discordId: ${inventory.discordId} | fragments: ${group._count.id}`);
		userFragments.push({
			discordId: inventory.discordId,
			amount: group._count.id,
		});
	}

	log('');
	log(`Total users to migrate: ${userFragments.length}`);
	log('--- END BACKUP LOG ---');
	log('');

	// 4. Seed FragmentBalance for each user
	log('Seeding FragmentBalance records...');
	let created = 0;
	let updated = 0;

	for (const user of userFragments) {
		const existing = await prisma.fragmentBalance.findUnique({
			where: { discordId: user.discordId },
			select: { id: true },
		});

		await prisma.fragmentBalance.upsert({
			where: { discordId: user.discordId },
			create: { discordId: user.discordId, amount: user.amount },
			update: { amount: user.amount },
		});

		if (existing) {
			updated++;
			log(`  UPDATED ${user.discordId}: set to ${user.amount} fragments`);
		} else {
			created++;
			log(`  CREATED ${user.discordId}: ${user.amount} fragments`);
		}
	}

	log(`FragmentBalance seeded: ${created} created, ${updated} updated.`);

	// 5. Delete all fragment OwnedCard rows
	log('');
	log(`Deleting ${totalFragmentRows} fragment OwnedCard rows...`);

	const deleteResult = await prisma.ownedCard.deleteMany({
		where: { cardId: fragmentCard.id },
	});

	log(`Deleted ${deleteResult.count} fragment OwnedCard rows.`);

	// 6. Verify
	const remaining = await prisma.ownedCard.count({
		where: { cardId: fragmentCard.id },
	});
	if (remaining > 0) {
		log(`WARNING: ${remaining} fragment OwnedCard rows still remain!`);
	} else {
		log('Verified: 0 fragment OwnedCard rows remaining.');
	}

	log('');
	log('=== FRAGMENT MIGRATION COMPLETE ===');
	log(`Log saved to: ${LOG_FILE}`);

	await prisma.$disconnect();
}

main().catch(async (err) => {
	console.error('Migrating fragments failed:', err);
	await prisma.$disconnect();
	process.exit(1);
});