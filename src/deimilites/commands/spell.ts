import { DeiMilitesGame } from '@prisma/client';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, ChatInputCommandInteraction, CommandInteraction, EmbedBuilder, ModalBuilder, SlashCommandBuilder, TextChannel, TextInputBuilder, TextInputStyle, User } from 'discord.js';
import { prisma } from '../..';
import { newDeiMilitesCommand, newSlashCommand } from '../../structures/SlashCommand';
import { fetchGame } from '../../util/deiActions';
import { checkIfHost } from '../utils/host';
import { createSpellPost, getSpell } from '../utils/spells';

const c = new SlashCommandBuilder();
c.setName('spell');
c.setDescription('Manage spells');

c.addSubcommand((cmd) => cmd.setName('create').setDescription('Submit a request to create a spell (or just create one if ur the host).'));
c.addSubcommand((cmd) =>
	cmd
		.setName('view')
		.setDescription('View a spell if you are authorized to.')
		.addStringOption((str) => str.setName('name').setDescription('Name of the spell').setRequired(true))
);

c.addSubcommand((cmd) =>
	cmd
		.setName('edit')
		.setDescription('Edit a spell if you are authorized to.')
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
						const name = i.options.getString('name', true);
						const { embed, hostrow } = await viewSpellAsHost(game, name);
						if (embed && hostrow) return await i.reply({ embeds: [embed] });
						else return await i.reply({ content: 'An unexpected error has occured, does a spell with the same name exist?', ephemeral: true });
					case 'create':
						const modal = new ModalBuilder();
						modal.setCustomId(`new-spell_${game.id}`);
						modal.setTitle('New Spell');

						const nameRow = new ActionRowBuilder<TextInputBuilder>();
						nameRow.addComponents(new TextInputBuilder().setCustomId('spell-name').setLabel('Spell Name').setStyle(TextInputStyle.Short).setRequired(true));

						const descRow = new ActionRowBuilder<TextInputBuilder>();
						descRow.addComponents(new TextInputBuilder().setCustomId('spell-effect').setLabel('Spell Effect/s').setStyle(TextInputStyle.Paragraph).setRequired(true));

						const costRow = new ActionRowBuilder<TextInputBuilder>();
						costRow.addComponents(new TextInputBuilder().setCustomId('spell-cost').setLabel('Spell Cost').setStyle(TextInputStyle.Short).setRequired(true));

						const sideEffect = new ActionRowBuilder<TextInputBuilder>();
						sideEffect.addComponents(new TextInputBuilder().setCustomId('spell-side-effect').setLabel('Side Effect/s').setStyle(TextInputStyle.Paragraph).setRequired(false));

						const hidden = new ActionRowBuilder<TextInputBuilder>();
						hidden.addComponents(new TextInputBuilder().setCustomId('spell-hidden').setLabel('Hidden Details').setStyle(TextInputStyle.Paragraph).setRequired(false));

						modal.setComponents(nameRow, descRow, costRow, sideEffect, hidden);
						await i.showModal(modal);
						break;
					case 'edit':
						triggerEditSpell(i, game);
						break;
					case 'list':
						triggerListSpells(i, game);
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

async function triggerListSpells(i: ChatInputCommandInteraction, game: DeiMilitesGame) {
	const spellCount = await prisma.spell.count({
		where: {
			game: { id: game.id },
		},
	});

	const spells = await prisma.spell.findMany({
		where: { game: { id: game.id } },
	});

	const embed = new EmbedBuilder();
	embed.setTitle('Spell List');
	embed.setDescription(`Total: ${spellCount}`);
	embed.setColor(0xff4145);

	await i.reply({ embeds: [embed] });
}

async function triggerEditSpell(i: ChatInputCommandInteraction, game: DeiMilitesGame) {
	const spellName = i.options.getString('name', true);
	const { spell } = await viewSpellAsHost(game, spellName);
	if (!spell) return i.reply({ content: 'Spell cannot be found', ephemeral: true });

	const modal = new ModalBuilder();
	modal.setCustomId(`edit-spell_${spell.id}`);
	modal.setTitle('Update Spell');

	const nameRow = new ActionRowBuilder<TextInputBuilder>();
	nameRow.addComponents(new TextInputBuilder().setCustomId('spell-name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(spell.name));

	const descRow = new ActionRowBuilder<TextInputBuilder>();
	descRow.addComponents(new TextInputBuilder().setCustomId('spell-effect').setLabel('Effect/s').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(spell.description));

	const costRow = new ActionRowBuilder<TextInputBuilder>();
	costRow.addComponents(new TextInputBuilder().setCustomId('spell-cost').setLabel('Cost').setStyle(TextInputStyle.Short).setRequired(true).setValue(spell.cost));

	const sideEffect = new ActionRowBuilder<TextInputBuilder>();
	sideEffect.addComponents(new TextInputBuilder().setCustomId('spell-side-effect').setLabel('Side Effect/s').setStyle(TextInputStyle.Paragraph).setRequired(false));

	const hidden = new ActionRowBuilder<TextInputBuilder>();
	hidden.addComponents(new TextInputBuilder().setCustomId('spell-hidden').setLabel('Hidden Details').setStyle(TextInputStyle.Paragraph).setRequired(false));

	modal.setComponents(nameRow, descRow, costRow, sideEffect, hidden);
	await i.showModal(modal);
}

async function viewSpellAsHost(game: DeiMilitesGame, spellName: string) {
	const spell = await getSpell(game.gameCategoryId, spellName);
	if (!spell) return { embed: null, row: null, spell: null };
	const { embed, hostrow } = createSpellPost(spell);
	return { embed, hostrow, spell };
}
