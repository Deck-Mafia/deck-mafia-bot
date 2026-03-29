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
        
        await i.deferReply({ flags: [MessageFlags.Ephemeral] });

        const channel = i.channel as TextChannel;
        if (!channel.parentId) return;

        const voteCounter = await checkVoteCountInChannel(i.channelId);
        if (!voteCounter) {
            return await i.editReply({ content: 'There is no vote counter' });
        }

        try {
            const data = await calculateVoteCount(voteCounter.id, i.guild);
            if (!data) throw Error('Could not calculate vote data');

            const voteCountEmbed = await createVoteCountPost(data, i.guild);
            await i.editReply({ embeds: [voteCountEmbed] });
            
        } catch (err) {
            console.error(err);         
            await i.editReply({ content: 'Requested vote count failed unexpectedly.' });
        }
    },
});