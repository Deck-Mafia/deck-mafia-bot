import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import { calculateVoteCount, checkVoteCountInChannel, createNewEvent, createVoteCountPost, PartialEvent } from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('unvote');
c.setDescription('Remove your vote from a player in a game');

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;
		const parentId = (i.channel as TextChannel).parentId;
		if (!parentId) return;

		const voteCounter = await checkVoteCountInChannel(i.channelId);
		if (!voteCounter) return await i.reply({ content: 'You cannot vote with the bot in a channel without an automated vote counter', ephemeral: true });

		await i.guild.members.fetch();
		const votingMember = i.guild.members.cache.get(i.user.id);

		try {
			let partial: PartialEvent = {
				playerId: i.user.id,
				canBeVoted: null,
				canVote: null,
				countsForMajority: null,
				isUnvoting: true,
				isVotingFor: null,
				voteWeight: null,
				createdAt: undefined,
			};

			const event = await createNewEvent(voteCounter.id, partial);

			await i.reply(`**${votingMember?.displayName ?? i.user.username}** has removed their vote.`);

			const data = await calculateVoteCount(voteCounter.id);
			if (!data) throw Error();

			const voteCount = await createVoteCountPost(data, i.guild);
			await i.followUp({ embeds: [voteCount] });
		} catch (err) {
			console.log(err);
			await i.reply({ ephemeral: true, content: 'Vote failed to occur. Please contact the host ASAP with who you wanted to vote if this continues.' });
		}
	},
});
