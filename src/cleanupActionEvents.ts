/**
 * One-time cleanup script for stale ActionEvents and inactive VoteCounts.
 *
 * Run with: npx ts-node src/cleanupActionEvents.ts
 *
 * Deletes:
 *   1. All ActionEvents belonging to inactive VoteCounts
 *   2. The inactive VoteCounts themselves
 *
 * Active vote counts (active: true) are left untouched.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function cleanup(prisma: PrismaClient) {
	console.log('=== ACTION EVENT CLEANUP STARTED ===');
	console.log('');

	// 1. Find all inactive vote counts
	const inactiveVCs = await prisma.voteCount.findMany({
		where: { active: false },
		select: { id: true, channelId: true, guildId: true },
	});

	console.log(`Found ${inactiveVCs.length} inactive VoteCount(s).`);

	if (inactiveVCs.length === 0) {
		console.log('Nothing to clean up.');
		console.log('');
		console.log('=== ACTION EVENT CLEANUP COMPLETE ===');
		return;
	}

	for (const vc of inactiveVCs) {
		console.log(`  VoteCount ${vc.id} (channel ${vc.channelId}, guild ${vc.guildId})`);
	}

	console.log('');

	// 2. Delete all ActionEvents for each inactive VoteCount
	let totalEventsDeleted = 0;

	for (const vc of inactiveVCs) {
		const result = await prisma.actionEvent.deleteMany({
			where: { voteCountId: vc.id },
		});
		totalEventsDeleted += result.count;
		console.log(`  → Deleted ${result.count} ActionEvent(s) from VoteCount ${vc.id}`);
	}

	console.log('');
	console.log(`Total ActionEvents deleted: ${totalEventsDeleted}`);

	// 3. Delete the inactive VoteCounts themselves
	console.log('');
	console.log('Deleting inactive VoteCounts...');

	let totalVCsDeleted = 0;

	for (const vc of inactiveVCs) {
		try {
			await prisma.voteCount.delete({
				where: { id: vc.id },
			});
			totalVCsDeleted++;
			console.log(`  → Deleted VoteCount ${vc.id}`);
		} catch (err: any) {
			console.error(`  ✗ Failed to delete VoteCount ${vc.id}: ${err.message}`);
		}
	}

	console.log('');
	console.log(`Total VoteCounts deleted: ${totalVCsDeleted}`);
	console.log('');
	console.log('=== ACTION EVENT CLEANUP COMPLETE ===');
}

// Standalone execution
if (require.main === module) {
	const prisma = new PrismaClient();

	cleanup(prisma)
		.then(() => prisma.$disconnect())
		.catch(async (err) => {
			console.error('Cleanup failed:', err);
			await prisma.$disconnect();
			process.exit(1);
		});
}

export { cleanup };