import { VoteCount } from '@prisma/client';
import { Guild, PermissionsBitField, TextChannel } from 'discord.js';
import { database } from '../..';
import { calculateVoteCount, createVoteCountPost } from './voteCount';

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
			await database.voteCount.update({
				where: {
					id,
				},
				data: {
					active: false,
				},
			});

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

			const vc = await calculateVoteCount(id);
			if (vc) {
				const embed = await createVoteCountPost(vc, guild);
				if (channel.isTextBased()) channel.send({ content: 'Day has ended', embeds: [embed] });
			}
		}
	}

	return;
}

export async function checkForRegularVoteCount({ guild, voteCount }: OnTickProps): Promise<unknown> {
	const { guildId, channelId, closeAt, id, lastPeriod } = voteCount;
	await guild.channels.fetch();
	const channel = guild.channels.cache.get(channelId);
	if (!channel) return; // Probably close VC if this is the case.

	if (!lastPeriod) return;
	const currentTimeMillis = Math.ceil(Date.now());
	const expectedTimeMillis = lastPeriod.getTime();
	if (currentTimeMillis > expectedTimeMillis) {
		await database.voteCount.update({
			where: {
				id,
			},
			data: {
				lastPeriod: new Date(currentTimeMillis + 1000 * 60 * 60 * 2),
			},
		});

		try {
			if (!channel.isTextBased()) throw Error();
			else {
				const vc = await calculateVoteCount(id);
				if (vc) {
					const embed = await createVoteCountPost(vc, guild);
					channel.send({ embeds: [embed] });
				}
			}
		} catch (err) {
			if (channel.isTextBased()) channel.send('Failed to lock channel. Do not post');
		}
	}

	return;
}
