import { PrismaClient } from '@prisma/client';
import { start as startDeckMafia } from './clients/deckmafia';
import { start as startdeiMilites } from './clients/deimilites';

export const prisma = new PrismaClient();

(async () => {
	startDeckMafia();
	startdeiMilites();
})();
