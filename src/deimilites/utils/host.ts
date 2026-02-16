import { DeiMilitesGame } from '@prisma/client';

export function checkIfHost(game: DeiMilitesGame, userID: string) {
	const isHost = true // ?? isHost = game.hostIds.includes(userID);
	return isHost;
}
