import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '..';
import { newSlashCommand, SlashCommand } from '../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('add');
c.setDescription('Add/change/update acard in the database');
c.addStringOption((input) => input.setName('name').setDescription('Name of the card').setRequired(true));
c.addStringOption((input) => input.setName('url').setDescription('URL of the image').setRequired(true));
c.addBooleanOption((i) => i.setName('public').setDescription('Is the card supposed to public and known to all? Default is no').setRequired(false));

export default newSlashCommand({
	data: c,
	async execute(i: CommandInteraction) {
		const name = i.options.get('name', true).value as string;
		const url = i.options.get('url', true).value as string;
		const publicOption = i.options.get('public', false);
		const isPublic = publicOption ? (publicOption.value as boolean) : false;

		try {
			const alreadyExists = await prisma.card.findUnique({ where: { name } });
			if (alreadyExists) return await i.reply('Card already exists with that name');

			const result = await prisma.card.create({
				data: {
					name: name.toLowerCase(),
					uri: url,
					isPublic: isPublic,
				},
			});

			await i.reply(`New Card: \`${result.name}\`\n${result.uri}`);
		} catch (err) {
			await i.reply({
				ephemeral: true,
				content: 'An unexpected error when adding a card has occurred',
			});
		}
	},
});
