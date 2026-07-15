import { VoteCount } from '@prisma/client';
import { Guild, PermissionsBitField, TextChannel } from 'discord.js';
import { database } from '../..';
import { calculateVoteCount, createVoteCountPost,getNextInterval } from './voteCount';

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
			try {
				await database.voteCount.update({
					where: {
						id,
					},
					data: {
						active: false,
					},
				});
			} catch (dbErr: any) {
				// DB unavailable — skip this tick, will retry next time
				console.error(`[checkOnClose] DB error deactivating VoteCount ${id}:`, dbErr?.message || dbErr);
				return;
			}

			try {
				if (!channel.isTextBased()) throw Error();
				else {
					await (channel as TextChannel).permissionOverwrites.set([
						{
							id: voteCount.livingRoleId,
							deny: [PermissionsBitField.Flags.SendMessages],
						},
					]);
				}
			} catch (err) {
				if (channel.isTextBased()) channel.send('Failed to lock channel. Do not post');
			}

			const vc = await calculateVoteCount(id, guild);
			if (vc) {
				const embed = await createVoteCountPost(vc, guild);
				if (channel.isTextBased()) channel.send({ content: 'Day has ended', embeds: [embed] });
			}

			// Clean up all ActionEvents and the VoteCount itself so the channel is free for a new counter
			await database.actionEvent.deleteMany({
				where: { voteCountId: id },
			});
			await database.voteCount.delete({
				where: { id },
			});
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
                const embed = await createVoteCountPost(vc, guild);
                await (channel as TextChannel).send({ embeds: [embed] });
                
                // ONLY update the timer if the message actually sent successfully
                await database.voteCount.update({
                    where: { id },
                    data: { lastPeriod: new Date(currentTimeMillis + 1000 * 60 * 60 * 2) },
                });
            }
        } catch (err) {
            console.error('[RegularVoteCount ERROR]', err);
        }
    }
}