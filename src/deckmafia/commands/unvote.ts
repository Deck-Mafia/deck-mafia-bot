import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { MessageFlags } from "discord.js";
import { newSlashCommand } from '../../structures/SlashCommand';
import { 
    calculateVoteCount, 
    checkVoteCountInChannel, 
    createNewEvent, 
    createVoteCountPost,
    triggerEndOfDay,
    EventPartial 
} from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('unvote');
c.setDescription('Remove your vote from a player in a game');

// DISABLED — /vote unvote:true is the canonical unvote path; this standalone command was broken (never removed players from wagons).
export default null;
/*
export default newSlashCommand({
    data: c,
    async execute(i: ChatInputCommandInteraction) {
        // 1. Defer immediately to give the bot time to work and fix the deprecation warning
        await i.deferReply({ flags: [MessageFlags.Ephemeral] });

        if (!i.guild) return;
        const parentId = (i.channel as TextChannel).parentId;
        if (!parentId) return;

        const voteCounter = await checkVoteCountInChannel(i.channelId);
        if (!voteCounter) {
            return await i.editReply({ 
                content: 'You cannot vote with the bot in a channel without an automated vote counter' 
            });
        }

        try {
            // 2. TARGETED FETCH: Fetch only the person unvoting, not the whole server
            const votingMember = await i.guild.members.fetch(i.user.id);

            let partial: EventPartial = {
                playerId: i.user.id,
                createdAt: undefined,
                // Note: Ensure your createNewEvent logic handles an unvote properly 
                // (usually by setting the target to the bot or null)
            };

            await createNewEvent(voteCounter.id, partial);

            // 3. Using editReply because we deferred at the start
            await i.editReply(`**${votingMember?.displayName ?? i.user.username}** has removed their vote.`);

            const data = await calculateVoteCount(voteCounter.id, i.guild);
            if (!data) throw Error();

            if (data.hammered) {
                await triggerEndOfDay(i.guild, data.voteCounter, data);
            } else {
                const voteCount = await createVoteCountPost(data, i.guild);
                await i.followUp({ 
                    embeds: [voteCount], 
                    flags: [MessageFlags.Ephemeral] 
                });
            }

        } catch (err) {
            console.error(err);
            // Since we deferred, we use editReply for the error message
            await i.editReply({ 
                content: 'Vote failed to occur. Please contact the host ASAP.' 
            });
        }
    },
});
*/
