import { ChatInputCommandInteraction, CommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { database, prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import { calculateVoteCount, checkGameInCategory, checkVoteCountInChannel, createNewEvent, createVoteCountPost, EventPartial } from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('votecount');
c.setDescription('View the current vote count');

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;
		await i.deferReply({ ephemeral: true });
		const parentId = (i.channel as TextChannel).parentId;
		if (!parentId) return;

		const voteCounter = await checkVoteCountInChannel(i.channelId);
		if (!voteCounter) return await i.editReply({ content: 'There is no vote counter' });

		try {
			const data = await calculateVoteCount(voteCounter.id);
			if (!data) throw Error();

			const voteCount = await createVoteCountPost(data, i.guild);
			await i.editReply({ embeds: [voteCount] });
		} catch (err) {
			console.log(err);
			await i.reply({ content: 'Requested vote count failed unexpectedly.' });
		}
	},
});
