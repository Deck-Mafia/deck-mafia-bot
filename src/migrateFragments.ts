/**
 * Fragment Migration Script
 *
 * Refactored to be callable both as a standalone script (npx ts-node) and
 * as an import from deckmafia.ts for auto‑migration on startup.
 *
 * TODO: DELETE THIS FILE AFTER THE MIGRATION HAS RUN ONCE AND ALL USERS
 *       HAVE BEEN MIGRATED TO THE FragmentBalance MODEL.
 */

import 'dotenv/config';
import { appendFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const LOG_FILE = '/home/botdev/rands/fragments.log';

function logLine(line: string) {
	const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
	const msg = `[${timestamp}] ${line}`;
	console.log(msg);
	appendFileSync(LOG_FILE, msg + '\n');
}

/**
 * Run the fragment migration.
 * @param prisma – an already‑connected PrismaClient instance
 * @returns true if any rows were migrated, false if there was nothing to do
 */
export async function migrateFragments(prisma: PrismaClient): Promise<boolean> {
	logLine('=== FRAGMENT MIGRATION STARTED ===');

	// 1. Find the fragment card template
	const fragmentCard = await prisma.card.findFirst({
		where: { name: 'fragment' },
		select: { id: true },
	});

	if (!fragmentCard) {
		logLine('No fragment card found in database. Nothing to migrate.');
		logLine('=== FRAGMENT MIGRATION COMPLETE (no action taken) ===');
		return false;
	}

	logLine(`Fragment card ID: ${fragmentCard.id}`);

	// 2. Group all fragment OwnedCards by inventoryId and count them
	const fragmentGroups = await prisma.ownedCard.groupBy({
		by: ['inventoryId'],
		where: { cardId: fragmentCard.id },
		_count: { id: true },
		orderBy: { inventoryId: 'asc' },
	});

	const totalFragmentRows = fragmentGroups.reduce((sum, g) => sum + g._count.id, 0);
	logLine(
		`Found ${totalFragmentRows} fragment OwnedCard rows across ${fragmentGroups.length} user(s).`,
	);

	if (fragmentGroups.length === 0) {
		logLine('No users have fragment cards. Nothing to migrate.');
		logLine('=== FRAGMENT MIGRATION COMPLETE (no action taken) ===');
		return false;
	}

	// 3. Resolve each inventory to a discordId and log the full list BEFORE modifying anything
	logLine('');
	logLine('--- USER FRAGMENT INVENTORY (backup log) ---');

	const userFragments: { discordId: string; amount: number }[] = [];

	for (const group of fragmentGroups) {
		const inventory = await prisma.inventory.findUnique({
			where: { id: group.inventoryId },
			select: { discordId: true },
		});

		if (!inventory) {
			logLine(
				`WARNING: Inventory ${group.inventoryId} has ${group._count.id} fragments but no longer exists. Skipping.`,
			);
			continue;
		}

		logLine(`  discordId: ${inventory.discordId} | fragments: ${group._count.id}`);
		userFragments.push({
			discordId: inventory.discordId,
			amount: group._count.id,
		});
	}

	logLine('');
	logLine(`Total users to migrate: ${userFragments.length}`);
	logLine('--- END BACKUP LOG ---');
	logLine('');

	// 4. Seed FragmentBalance for each user
	logLine('Seeding FragmentBalance records...');
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
			logLine(`  UPDATED ${user.discordId}: set to ${user.amount} fragments`);
		} else {
			created++;
			logLine(`  CREATED ${user.discordId}: ${user.amount} fragments`);
		}
	}

	logLine(`FragmentBalance seeded: ${created} created, ${updated} updated.`);

	// 5. Delete all fragment OwnedCard rows
	logLine('');
	logLine(`Deleting ${totalFragmentRows} fragment OwnedCard rows...`);

	const deleteResult = await prisma.ownedCard.deleteMany({
		where: { cardId: fragmentCard.id },
	});

	logLine(`Deleted ${deleteResult.count} fragment OwnedCard rows.`);

	// 6. Verify
	const remaining = await prisma.ownedCard.count({
		where: { cardId: fragmentCard.id },
	});
	if (remaining > 0) {
		logLine(`WARNING: ${remaining} fragment OwnedCard rows still remain!`);
	} else {
		logLine('Verified: 0 fragment OwnedCard rows remaining.');
	}

	logLine('');
	logLine('=== FRAGMENT MIGRATION COMPLETE ===');
	logLine(`Log saved to: ${LOG_FILE}`);

	return true;
}

// ---- Standalone execution (npx ts-node src/migrateFragments.ts) ----
if (require.main === module) {
	const prisma = new PrismaClient();

	migrateFragments(prisma)
		.then(() => prisma.$disconnect())
		.catch(async (err) => {
			console.error('Migrating fragments failed:', err);
			await prisma.$disconnect();
			process.exit(1);
		});
}