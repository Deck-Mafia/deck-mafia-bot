import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('delete');
c.setDescription('Add/change/update acard in the database');
c.addStringOption((input) => input.setName('name').setDescription('Name of the card').setRequired(true));

export default newSlashCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const name = i.options.get('name', true).value as string;

		try {
			const response = await prisma.card.delete({
				where: {
					name: name.toLowerCase(),
				},
			});

			await i.reply({ content: `\`${name}\` has been deleted. If this was a mistake, run the \`add\` command again to add it back` });
		} catch (err) {
			await i.reply({
				ephemeral: true,
				content: 'An error has occurred when deleting this card.',
			});
		}

		// await i.reply('Deleted card');
		// await i.reply(`https://media.discordapp.net/attachments/830178132744601610/831591745456046130/image0.png`);
	},
});
