import { DeiMilitesGame, DeiMilitesPlayer } from '@prisma/client';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, Colors, CommandInteraction, Embed, EmbedBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextChannel, User, UserSelectMenuBuilder } from 'discord.js';
import { prisma } from '../..';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('dashboard');
c.setDescription('Show host information about a game.');

export default newDeiMilitesCommand({
	data: c,
	async execute(i: CommandInteraction) {
		try {
			const channel = i.channel as TextChannel;
			const category = channel.parent;
			if (!category) return await i.reply('Category is invalid');

			const game = await prisma.deiMilitesGame.findUnique({
				where: { gameCategoryId: category.id },
				include: {
					players: true,
				},
			});
			if (!game) return await i.reply('Game does not exist. Use the /newgame command to create one.');

			let playerString = '';
			let deadPlayerString = '';
			game.players.forEach((v) => {
				let value = `<@${v.discordId}> (${v.health} HP)\n`;
				if (v.isDead) deadPlayerString += value;
				else playerString += value;
			});

			if (playerString == '') playerString = 'N/A';
			if (deadPlayerString == '') deadPlayerString = 'N/A';

			const embed = new EmbedBuilder();
			embed.setTitle('Game Dashboard');
			embed.setColor(Colors.Blurple);
			embed.addFields(
				{
					name: 'Living',
					value: playerString.trim(),
				},
				{
					name: 'Dead',
					value: deadPlayerString.trim(),
				}
			);

			const row = new ActionRowBuilder<UserSelectMenuBuilder>();
			row.addComponents(new UserSelectMenuBuilder().setCustomId('manage-player').setMaxValues(1).setPlaceholder('Select a player to manage information about them.'));

			i.reply({ embeds: [embed], components: [row] });
		} catch (err) {
			await i.reply('An error has occurred');
		}
	},
});
