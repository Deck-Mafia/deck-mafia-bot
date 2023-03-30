import { DeiMilitesGame } from '@prisma/client';
import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { database } from '../..';
import { newDeiMilitesCommand } from '../../structures/SlashCommand';
import { fetchGame, newElement } from '../../util/deiActions';
import { checkIfHost } from '../utils/host';

const c = new SlashCommandBuilder();
c.setName('elements');
c.setDescription('Manage elements');

c.addSubcommand((cmd) =>
	cmd
		.setName('create')
		.setDescription('Create a new element')
		.addStringOption((str) => str.setName('name').setDescription('Name of the new element').setRequired(true))
);

export default newDeiMilitesCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		try {
			const subcommand = i.options.getSubcommand();
			const game = await fetchGame(i.channel as TextChannel);
			if (!game) return i.reply('Cannot use this command outside of a game');
			const isHost = checkIfHost(game, i.user.id);
			if (!isHost) return i.reply('Only a host can use this command');

			switch (subcommand) {
				case 'create':
					return createElement(i, game);
				default:
					return await i.reply('Functionality not yet implemented.');
			}
		} catch (err) {
			console.log(err);
			await i.reply('An error has occurred');
		}
	},
});

async function createElement(i: ChatInputCommandInteraction, game: DeiMilitesGame) {
	try {
		const name = i.options.getString('name', true).toLowerCase();
		const existingElement = await database.element.findFirst({
			where: {
				game: {
					id: game.id,
				},
				name: name,
			},
		});

		if (existingElement) return i.reply({ embeds: [newElement(existingElement.name, false)] });

		const element = await database.element.create({
			data: {
				game: {
					connect: {
						id: game.id,
					},
				},
				name: name,
			},
		});

		return i.reply({ embeds: [newElement(element.name, true)] });
	} catch (err) {
		console.log(err);
		await i.reply('An error has occurred');
	}
}
