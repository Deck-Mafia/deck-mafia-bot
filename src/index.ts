// added to import my .env file
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import '@total-typescript/ts-reset';
import { start as startDeckMafia } from './clients/deckmafia';
import { start as startdeiMilites } from './clients/deimilites';
import { cleanup } from './cleanupActionEvents';

export const prisma = new PrismaClient();
export const database = prisma;

(async () => {
	// One-time cleanup: purge years of stale ActionEvents and dead VoteCounts.
	// TODO: Remove this call after it runs successfully once.
	await cleanup(prisma);

	startDeckMafia();
//	startdeiMilites();
})();
