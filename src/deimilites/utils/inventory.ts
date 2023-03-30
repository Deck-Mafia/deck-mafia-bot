import { DeiMilitesPlayer } from '@prisma/client';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { prisma } from '../..';

export async function getPlayer(channel: TextChannel, discordId: string) {
	const parent = channel.parent;
	if (!parent) return null;

	const player = await prisma.deiMilitesPlayer.findFirst({
		where: {
			game: {
				gameCategoryId: parent.id,
			},
			discordAccountId: discordId,
		},
	});

	return player;
}

export async function createInventoryEmbed(player: DeiMilitesPlayer) {
	const embed = new EmbedBuilder();
	embed.setTitle('Game Inventory');
	embed.setDescription(`**User:** <@${player.discordAccountId}>`);
	embed.setColor(0xf8a211);

	embed.addFields({
		name: 'Chel',
		value: player.chel.toString(),
	});
}
