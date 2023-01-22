import { CommandInteraction, SlashCommandBuilder, TextChannel, User } from 'discord.js';
import { prisma } from '../..';
import { ActionType } from '../../structures/DeiMilites';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('bid');
c.setDescription('Bid on an element as your action');
c.addStringOption((str) => str.setName('element').setDescription('Element you want to bid on').setRequired(true));

// Check if it's something you can bid on.
// If you can, submit bid on that.
// Otherwise, throw error.

export default newDeiMilitesCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const channel = i.channel as TextChannel;
		const category = channel.parent;
		if (!category) return await i.reply('Category is invalid');

		const element = i.options.get('element', true).value as string;

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
					type: ActionType.BID,
					author: {
						connect: {
							id: player.id,
						},
					},
					data: element,
				},
			});

			await i.reply({ content: `You have submitted your action to be a bid for ${element}` });
		} catch (err) {
			await i.reply({ content: 'Unknown error has occurred. If this continues to happen, send your action to the host manually' });
		}
	},
});
