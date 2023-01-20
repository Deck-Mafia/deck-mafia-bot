import { DeiMilitesAction, DeiMilitesGame, DeiMilitesPlayer } from '@prisma/client';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, Colors, CommandInteraction, Embed, EmbedBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextChannel, User, UserSelectMenuBuilder } from 'discord.js';
import { prisma } from '../..';
import { client } from '../../clients/deimilites';
import { ActionType } from '../../structures/DeiMilites';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('process');
c.setDescription('[Host] Process actions');

export default newDeiMilitesCommand({
	data: c,
	async execute(i: CommandInteraction) {
		try {
			const channel = i.channel as TextChannel;
			const category = channel.parent;
			if (!category) return await i.reply('Category is invalid');

			const game = await prisma.deiMilitesGame.findUnique({
				where: {
					gameCategoryId: category.id,
				},
				include: {
					players: true,
				},
			});

			if (!game) return await i.reply({ content: 'There is no registered game in this category', ephemeral: true });

			const players: Record<string, DeiMilitesAction | null> = {};
			let amountOfPasses = 0;

			const bids: Record<string, string> = {};
			const bidAmounts: Record<string, number> = {};

			for (let index = 0; index < game.players.length; index++) {
				const player = game.players[index];
				const allActions = await prisma.deiMilitesAction.findMany({
					where: { author: { discordId: player.discordId } },
					orderBy: { createdAt: 'desc' },
				});

				const lastAction = allActions[0];
				if (!lastAction || lastAction.type == 'pass') amountOfPasses += 1;
				else if (lastAction.type == 'bid' && lastAction.data) {
					bids[player.discordId] = lastAction.data;
					if (!bidAmounts[lastAction.data]) bidAmounts[lastAction.data] = 1;
					else {
						bidAmounts[lastAction.data] = bidAmounts[lastAction.data] + 1;
					}
				}
				players[player.discordId] = lastAction;
			}

			let amounts = ``;

			for (const discordId in bids) {
				const bid = bids[discordId];
				let amountAbove = 0;
				let amountSame = bidAmounts[bid];

				for (const biddedElement in bidAmounts) {
					if (biddedElement != bid) {
						if (bidAmounts[biddedElement] > amountSame) amountAbove += 1;
					}
				}

				let value = 1;

				for (let i = 0; i < amountAbove; i++) {
					value = Math.ceil(value * 1.5);
				}

				if (amountSame > 1) value = 1;

				amounts += `<@${discordId}> receives ${value} ${bid}`;
			}

			console.log(amounts);
			console.log(bidAmounts, amountOfPasses);

			await i.reply({
				content: amounts.trim(),
				allowedMentions: {
					users: [],
				},
			});
		} catch (err) {
			await i.reply('An error has occurred');
		}
	},
});
