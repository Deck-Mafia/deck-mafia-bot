import { DeiMilitesGame } from '@prisma/client';
import { ActionRowBuilder, ChatInputCommandInteraction, EmbedBuilder, ModalBuilder, SlashCommandBuilder, TextChannel, TextInputBuilder, TextInputStyle, User } from 'discord.js';
import { prisma } from '../..';
import { newDeiMilitesCommand } from '../../structures/SlashCommand';
import { fetchGame } from '../../util/deiActions';
import { checkIfHost } from '../utils/host';
import { createSpellPost, getSpell } from '../utils/spells';

const c = new SlashCommandBuilder();
c.setName('items');
c.setDescription('Manage items');

c.addSubcommand((cmd) => cmd.setName('create').setDescription('Create a new item'));
c.addSubcommand((cmd) =>
	cmd
		.setName('view')
		.setDescription('View an existing item.')
		.addStringOption((str) => str.setName('name').setDescription('Name of the item').setRequired(true))
);

c.addSubcommand((cmd) =>
	cmd
		.setName('edit')
		.setDescription('Edit an item')
		.addStringOption((str) => str.setName('name').setDescription('Name of the spell').setRequired(true))
);

c.addSubcommand((cmd) => cmd.setName('list').setDescription('View all spells if you are authorized to.'));

export default newDeiMilitesCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		try {
			const subcommand = i.options.getSubcommand();
			const game = await fetchGame(i.channel as TextChannel);
			if (!game) return i.reply('Cannot use this command outside of a game');
			const isHost = checkIfHost(game, i.user.id);
			if (!isHost) return i.reply('Only a host can use this command');

			if (subcommand)
				switch (subcommand) {
					case 'view':
						break;
					case 'create':
						const modal = new ModalBuilder();
						modal.setCustomId(`new-item_${game.id}`);
						modal.setTitle('New Item');

						const nameRow = new ActionRowBuilder<TextInputBuilder>();
						nameRow.addComponents(new TextInputBuilder().setCustomId('item-name').setLabel('Item Name').setStyle(TextInputStyle.Short).setRequired(true));

						const descRow = new ActionRowBuilder<TextInputBuilder>();
						descRow.addComponents(new TextInputBuilder().setCustomId('item-effect').setLabel('Effect/s').setStyle(TextInputStyle.Paragraph).setRequired(true));

						const costRow = new ActionRowBuilder<TextInputBuilder>();
						costRow.addComponents(new TextInputBuilder().setCustomId('item-cost').setLabel('Cost to Purchase').setStyle(TextInputStyle.Short).setRequired(false));

						const hidden = new ActionRowBuilder<TextInputBuilder>();
						hidden.addComponents(new TextInputBuilder().setCustomId('item-hidden').setLabel('Hidden Details').setStyle(TextInputStyle.Paragraph).setRequired(false));

						modal.setComponents(nameRow, descRow, costRow, hidden);
						await i.showModal(modal);
						break;
					case 'edit':
						break;
					default:
						break;
				}
		} catch (err) {
			console.log(err);
			await i.reply('An error has occurred');
		}
	},
});
