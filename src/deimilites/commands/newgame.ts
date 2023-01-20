import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, CommandInteraction, SlashCommandBuilder, TextChannel, User } from 'discord.js';
import { prisma } from '../..';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';

const generateUsers = (command: SlashCommandBuilder, amount: number) => {
	for (let i = 0; i < amount; i++) {
		command.addUserOption((user) => user.setName(`player_${i + 1}`).setDescription('A player to add to the game'));
	}
};

const c = new SlashCommandBuilder();
c.setName('newgame');
c.setDescription('Create a game of Dei Milites under this category');
generateUsers(c, 10);

export default newDeiMilitesCommand({
	data: c,
	async execute(i: CommandInteraction) {
		try {
			const channel = i.channel as TextChannel;
			const category = channel.parent;
			if (!category) return await i.reply('Category is invalid');

			let players: string[] = [];
			const options = i.options;
			for (let i = 0; i < 10; i++) {
				const playerTmp = options.getUser(`player_${i + 1}`);
				if (playerTmp) players.push(playerTmp.id);
			}

			console.log(players);

			const gameExists = await prisma.deiMilitesGame.findUnique({ where: { gameCategoryId: category.id } });
			if (gameExists) return await i.reply('Game using this category already exists.');

			const newGame = await prisma.deiMilitesGame.create({
				data: {
					gameCategoryId: category.id,
				},
			});

			for (let index = 0; index < players.length; index++) {
				await prisma.deiMilitesPlayer.create({
					data: {
						discordId: players[index],
						game: {
							connect: {
								id: newGame.id,
							},
						},
					},
				});
			}

			const row = new ActionRowBuilder<ButtonBuilder>();
			row.addComponents(new ButtonBuilder().setCustomId('manage-players').setStyle(ButtonStyle.Primary).setLabel('Manage Players'));

			await i.reply({ components: [row] });
		} catch (err) {
			await i.reply('An error has occurred');
		}
	},
});
