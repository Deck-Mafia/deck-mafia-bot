import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { MessageFlags } from "discord.js";
import { newSlashCommand } from '../../structures/SlashCommand';
import { calculateVoteCount, checkVoteCountInChannel, createVoteCountPost } from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('votecount');
c.setDescription('View the current vote count');

export default newSlashCommand({
    data: c,
    async execute(i: ChatInputCommandInteraction) {
        if (!i.guild) return;

        // Defer immediately to prevent timeout
        await i.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => {});

        const channel = i.channel as TextChannel;
        if (!channel?.parentId) {
            return await i.editReply({ content: 'This command can only be used in a game channel.' }).catch(() => {});
        }

        const voteCounter = await checkVoteCountInChannel(i.channelId);
        if (!voteCounter) {
            return await i.editReply({ content: 'There is no vote counter in this channel.' }).catch(() => {});
        }

        try {
            const data = await calculateVoteCount(voteCounter.id, i.guild);
            if (!data) {
                return await i.editReply({ content: 'Could not calculate vote data.' }).catch(() => {});
            }

            const voteCountEmbed = await createVoteCountPost(data, i.guild);
            await i.editReply({ embeds: [voteCountEmbed] }).catch(() => {});

        } catch (err) {
            console.error('[VOTECOUNT ERROR]', err);
            await i.editReply({ 
                content: 'There was an error while generating the vote count. Please try again.' 
            }).catch(() => {});
        }
    },
});