import { APIApplicationCommandGuildInteraction, CommandInteraction, MessageInteraction, SlashCommandBuilder, TextChannel, User } from 'discord.js';
import { prisma } from '../..';
import { ActionType } from '../../structures/DeiMilites';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('spell');
c.setDescription('Spell');

c.addSubcommand((cmd) =>
	cmd
		.setName('create')
		.setDescription('Create a new spell')
		.addStringOption((str) => str.setName('name').setDescription('what the spell does').setRequired(true))
);

export default newDeiMilitesCommand({
	data: c,
	async execute(i) {
		const channel = i.channel as TextChannel;
		const category = channel.parent;
		if (!category) return await i.reply('Category is invalid');

		// console.log(i.options.get('create'));

		try {
			await i.reply({ content: 'Test', ephemeral: true });
		} catch (err) {
			await i.reply({ content: 'Unknown error has occurred. If this continues to happen, send your action to the host manually' });
		}
	},
});
