import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';

const c = new SlashCommandBuilder();
c.setName('unvote');
c.setDescription('Remove your vote from a player in a game');

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		await i.reply(`<@${i.user.id}> (${i.user.username}) has removed their vote.`);
	},
});
