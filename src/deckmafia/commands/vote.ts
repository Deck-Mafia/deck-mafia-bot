import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { database, prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import { checkGameInCategory, checkVoteCountInChannel } from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('vote');
c.setDescription('Vote for a player in a game');

c.addUserOption((user) => user.setName('player').setDescription('Player you wish to vote.').setRequired(true));

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;
		const parentId = (i.channel as TextChannel).parentId;
		if (!parentId) return;

		const voteCounter = await checkVoteCountInChannel(i.channelId);
		if (!voteCounter) return await i.reply({ content: 'You cannot vote with the bot in a channel without an automated vote counter', ephemeral: true });

		// const voteCounterPost = await createVoteCountPost(i.guild, voteCounter);
		// await i.reply({ embeds: [voteCounterPost] });

		// const isVoteLocked = false;
		// if (isVoteLocked) return await i.reply({ content: 'You cannot change your vote as votes are locked', ephemeral: true });

		// await i.reply(`<@${i.user.id}> (${i.user.username}) has voted for <@${i.options.getUser('player', true).id}> (${i.options.getUser('player', true).username})`);
	},
});
