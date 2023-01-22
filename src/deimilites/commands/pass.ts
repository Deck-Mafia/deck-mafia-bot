import { CommandInteraction, SlashCommandBuilder, TextChannel, User } from 'discord.js';
import { prisma } from '../..';
import { ActionType } from '../../structures/DeiMilites';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('pass');
c.setDescription('Submit pass as your action');

export default newDeiMilitesCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const channel = i.channel as TextChannel;
		const category = channel.parent;
		if (!category) return await i.reply('Category is invalid');

		try {
			const player = await prisma.deiMilitesPlayer.findFirst({
				where: {
					discordId: i.user.id,
					game: {
						gameCategoryId: category.id,
					},
				},
			});

			if (!player) return await i.reply({ content: 'You are not registered as a player', ephemeral: true });

			const submittedAction = await prisma.deiMilitesAction.create({
				data: {
					type: ActionType.PASS,
					author: {
						connect: {
							id: player.id,
						},
					},
				},
			});

			await i.reply({ content: 'Submitted `pass` as an action.' });
		} catch (err) {
			await i.reply({ content: 'Unknown error has occurred. If this continues to happen, send your action to the host manually' });
		}
	},
});
