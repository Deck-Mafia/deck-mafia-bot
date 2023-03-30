import { EmbedBuilder, Interaction, TextChannel } from 'discord.js';
import { prisma } from '..';

export async function fetchGame(channel: TextChannel) {
	const category = channel.parent;
	if (!category) return null;
	const gameExists = await prisma.deiMilitesGame.findUnique({
		where: { gameCategoryId: category.id },
		include: {
			hosts: true,
		},
	});
	return gameExists;
}

export enum ActionType {
	PASS = 'pass',
}

export interface ActionSubmission {
	categoryId: string;
	authorDiscordId: string;
}

export enum ActionSubmissionResult {
	SUCCESS = 'success',
	MULTI_TASK_REQUEST = 'multitask',
	FAILURE = 'failure',
	INVALID = 'invalid',
}

export async function getPlayer(gameCategory: string, discordId: string) {
	const result = await prisma.deiMilitesPlayer.findFirst({
		where: {
			game: {
				gameCategoryId: gameCategory,
			},
			account: {
				discordId,
			},
		},
	});

	return result;
}

export function updateElements(discordId: string, element: string, newAmount: number) {
	const embed = new EmbedBuilder();
	embed.setTitle('Updated Elements');
	embed.setDescription(`<@${discordId}> now has ${newAmount} ${element} elements`);
	embed.setColor(0xeedc04);

	return embed;
}

export function newElement(element: string, success: boolean) {
	if (success) {
		const embed = new EmbedBuilder();
		embed.setTitle('New Elements');
		embed.setDescription(`\`${element}\` has been created as an element.`);
		embed.setColor(0xeedc04);
		return embed;
	} else {
		const embed = new EmbedBuilder();
		embed.setTitle('New Elements - Conflict');
		embed.setDescription(`\`${element}\` already exists as an element.`);
		embed.setColor(0xeedc04);
		return embed;
	}
}
