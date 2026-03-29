import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { MessageFlags } from "discord.js";
import { newSlashCommand } from '../../structures/SlashCommand';
import {
    calculateVoteCount,
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

        // 1. ACKNOWLEDGE IMMEDIATELY
        // Moving this to the absolute top is good, but we can also use a try/catch
        // to handle cases where the Pi was too slow to even defer.
        try {
            await i.deferReply();
        } catch (e: any) {
            console.warn(`[VOTE] Failed to defer: ${e.message}`);
            return; // Interaction is already dead, no point in continuing
        }

        try {
            // 2. RUN INDEPENDENT TASKS IN PARALLEL
            // Instead of waiting for one then the other, do both at once.
            const [voteCounter, votingMember] = await Promise.all([
                checkVoteCountInChannel(i.channelId),
                i.guild.members.fetch(i.user.id)
            ]);

            if (!voteCounter) {
                return await i.editReply({ 
                    content: 'You cannot vote in a channel without an active vote counter.' 
                });
            }

            const votedUser = i.options.getUser('player', false);
            const isUnvoting = i.options.getBoolean('unvote', false);

            // 3. LOGIC FOR UNVOTE / VOTE
            let targetId = i.client.user!.id; // Default to Bot ID (Unvote)
            let successMessage = `**${votingMember?.displayName ?? i.user.username}** has removed their vote`;

            if (!isUnvoting && votedUser) {
                // Surgical fetch for the target to check roles
                const votedMember = await i.guild.members.fetch(votedUser.id);
                const hasAliveRole = votedMember.roles.cache.some(r => r.name === 'Alive' || r.name === 'Alive 2');

                if (!hasAliveRole) {
                    return await i.editReply({ content: 'You may only vote for players who are alive.' });
                }

                targetId = votedUser.id;
                successMessage = `**${votingMember?.displayName ?? i.user.username}** has voted for **${votedMember?.displayName ?? votedUser.username}**`;
            }

            // 4. DATABASE & RE-CALCULATION
            await createNewEvent(voteCounter.id, {
                playerId: i.user.id,
                isVotingFor: targetId,
            });

            // 5. UPDATE USER
            await i.editReply(successMessage);

            // 6. POST UPDATED EMBED (NON-BLOCKING)
            // We don't necessarily need to "await" the final followUp to finish 
            // the command, but on a Pi, it's safer to keep it sequential.
            const data = await calculateVoteCount(voteCounter.id, i.guild);
            if (data) {
                const voteCountEmbed = await createVoteCountPost(data, i.guild);
                await i.followUp({ 
                    embeds: [voteCountEmbed], 
                    flags: [MessageFlags.Ephemeral] 
                });
            }

        } catch (err) {
            console.error('[VOTE ERROR]', err);
            // Check if interaction is still valid before editing reply
            if (i.deferred || i.replied) {
                await i.editReply({ content: 'Vote failed. Please try again in a moment.' });
            }
        }
    },
});