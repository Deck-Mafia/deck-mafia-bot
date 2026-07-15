import { VoteCount } from '@prisma/client';
import { Guild, PermissionsBitField, TextChannel } from 'discord.js';
import { database } from '../..';
import { calculateVoteCount, createVoteCountPost, getNextInterval, triggerEndOfDay } from './voteCount';

export type OnTickProps = {
	guild: Guild;
	voteCount: VoteCount;
};

export async function checkOnClose({ guild, voteCount }: OnTickProps): Promise<unknown> {
	const { guildId, channelId, closeAt, id } = voteCount;
	await guild.channels.fetch();
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return; // Probably close VC if this is the case.

	if (closeAt) {
		const currentTimeMillis = Math.ceil(Date.now());
		const expectedTimeMillis = closeAt.getTime();

		if (currentTimeMillis > expectedTimeMillis) {
			const vc = await calculateVoteCount(id, guild);
			if (vc) {
				await triggerEndOfDay(guild, voteCount, vc);
			}
		}
	}

	return;
}

export async function checkForRegularVoteCount({ guild, voteCount }: OnTickProps): Promise<unknown> {
    const { channelId, id, lastPeriod } = voteCount;
	
    // If no lastPeriod is set, let's initialize one now so it starts working
    if (!lastPeriod) {
        await database.voteCount.update({
            where: { id },
            data: { lastPeriod: getNextInterval() }
        });
        return;
    }

    const currentTimeMillis = Date.now();
    if (currentTimeMillis > lastPeriod.getTime()) {
        try {
            const channel = await guild.channels.fetch(channelId);
            if (!channel || !channel.isTextBased()) return;

            const vc = await calculateVoteCount(id, guild);
            if (vc) {
                if (vc.hammered) {
                    await triggerEndOfDay(guild, voteCount, vc);
                } else {
                    const embed = await createVoteCountPost(vc, guild);
                    await (channel as TextChannel).send({ embeds: [embed] });
                    
                    // ONLY update the timer if the message actually sent successfully
                    await database.voteCount.update({
                        where: { id },
                        data: { lastPeriod: new Date(currentTimeMillis + 1000 * 60 * 60 * 2) },
                    });
                }
            }
        } catch (err) {
            console.error('[RegularVoteCount ERROR]', err);
        }
    }
}