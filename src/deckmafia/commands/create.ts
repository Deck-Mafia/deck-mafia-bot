import { ChannelType, ChatInputCommandInteraction, CommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { mem } from 'node-os-utils';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import { checkGameInCategory, createGame, createPlayer } from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('create');
c.setDescription('Create something regarding deck mafia games.');

c.addSubcommand((cmd) =>
	cmd
		.setName('game')
		.setDescription('Game')
		.addChannelOption((x) => x.setName('category').setDescription('Category the game will run under').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
		.addRoleOption((x) => x.setName('alive').setDescription('Role that living players.').setRequired(true))
		.addRoleOption((x) => x.setName('dead').setDescription('Role that dead players.').setRequired(true))
		.addRoleOption((x) => x.setName('missing').setDescription('Role that missing players.').setRequired(true))
);

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;
		if (i.options.getSubcommand(true) != 'game') return;
		const category = i.options.getChannel('category', true);
		const aliveRole = i.options.getRole('alive', true);
		const deadRole = i.options.getRole('dead', true);
		const missingRole = i.options.getRole('missing', true);

		const gameExist = await checkGameInCategory(category.id);
		if (gameExist) return i.reply('Game already exists in this category');

		await i.guild.members.fetch();

		const livingPlayers = Array.from(i.guild.members.cache.filter((m) => m.roles.cache.get(aliveRole.id)));
		const game = await createGame(category.id, aliveRole.id, deadRole.id, missingRole.id);
		if (!game) return i.reply('Unable to create a new game in this category');

		let failedUsers: string[] = [];
		let successful: string[] = [];
		for (let i = 0; i < livingPlayers.length; i++) {
			const member = livingPlayers[i][1];
			const player = await createPlayer(game.id, member.user.id);
			if (!player) failedUsers.push(member.user.username);
			else successful.push(member.user.username);
		}

		const embed = new EmbedBuilder();
		embed.setTitle('New Game');
		embed.setColor('LuminousVividPink');
		embed.addFields(
			{
				name: 'Successfully Added',
				value: ('All players include\n' + successful.join('\n')).trim(),
			},
			{
				name: 'Failed to Add',
				value: ('All players include\n' + failedUsers.join('\n')).trim(),
			}
		);
	},
});
