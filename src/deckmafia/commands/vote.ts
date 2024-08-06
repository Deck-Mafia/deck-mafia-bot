import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { database, prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import {
	calculateVoteCount,
	checkGameInCategory,
	checkVoteCountInChannel,
	createNewEvent,
	createVoteCountPost,
	EventPartial,
} from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('vote');
c.setDescription('Vote for a player in a game');

c.addUserOption((user) => user.setName('player').setDescription('Player you wish to vote.').setRequired(false));
c.addBooleanOption((bool) => bool.setName('unvote').setDescription('Unvote for a player').setRequired(false));

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;
		const parentId = (i.channel as TextChannel).parentId;
		if (!parentId) return;
		const voteCounter = await checkVoteCountInChannel(i.channelId);
		if (!voteCounter)
			return await i.reply({ content: 'You cannot vote with the bot in a channel without an automated vote counter', ephemeral: true });

		const votedUser = i.options.getUser('player', false);
		const isUnvoting = i.options.getBoolean('unvote', false);

		if (isUnvoting) {
			const votedId = i.client.user.id;

			await i.guild.members.fetch();

			const votedMember = i.guild.members.cache.get(votedId);
			const votingMember = i.guild.members.cache.get(i.user.id);

			try {
				let partial: EventPartial = {
					playerId: i.user.id,
					isVotingFor: votedId,
				};

				const event = await createNewEvent(voteCounter.id, partial);
				await i.reply(`**${votingMember?.displayName ?? i.user.username}** has removed their vote`);
				await i.reply(
					`**${votingMember?.displayName ?? i.user.username}** has voted for **${votedMember?.displayName ?? votedUser.username}**`
				);

				const data = await calculateVoteCount(voteCounter.id);
				if (!data) throw Error();

				const voteCount = await createVoteCountPost(data, i.guild);
				await i.followUp({ embeds: [voteCount], ephemeral: true });
			} catch (err) {
				console.log(err);
				await i.reply({
					ephemeral: true,
					content: 'Vote failed to occur. Please contact the host ASAP with who you wanted to vote if this continues.',
				});
			}
		} else if (votedUser) {
			const votedId = votedUser.id;

			const voteCounter = await checkVoteCountInChannel(i.channelId);
			if (!voteCounter)
				return await i.reply({ content: 'You cannot vote with the bot in a channel without an automated vote counter', ephemeral: true });

			await i.guild.members.fetch();

			const votedMember = i.guild.members.cache.get(votedId);
			const votingMember = i.guild.members.cache.get(i.user.id);

			try {
				let partial: EventPartial = {
					playerId: i.user.id,
					isVotingFor: votedId,
				};

				const event = await createNewEvent(voteCounter.id, partial);
				await i.reply(
					`**${votingMember?.displayName ?? i.user.username}** has voted for **${votedMember?.displayName ?? votedUser.username}**`
				);

				const data = await calculateVoteCount(voteCounter.id);
				if (!data) throw Error();

				const voteCount = await createVoteCountPost(data, i.guild);
				await i.followUp({ embeds: [voteCount], ephemeral: true });
			} catch (err) {
				console.log(err);
				await i.reply({
					ephemeral: true,
					content: 'Vote failed to occur. Please contact the host ASAP with who you wanted to vote if this continues.',
				});
			}
		}
	},
});
