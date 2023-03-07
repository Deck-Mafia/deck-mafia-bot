import { EmbedBuilder } from '@discordjs/builders';
import { ActionEvent, RegisteredGame, VoteCount } from '@prisma/client';
import { Colors, Guild, GuildMember } from 'discord.js';
import { mem } from 'node-os-utils';
import { listenerCount } from 'process';
import { database } from '../..';

export async function checkGameInCategory(categoryId: string) {
	const [game] = await Promise.allSettled([
		database.registeredGame.findUnique({
			where: {
				categoryId: categoryId,
			},
		}),
	]);

	if (game.status == 'rejected') return null;
	else return game.value;
}

export async function checkVoteCountInChannel(channelId: string) {
	const [voteCount] = await Promise.allSettled([
		database.voteCount.findUnique({
			where: {
				channelId,
			},
		}),
	]);

	if (voteCount.status == 'rejected') return null;
	return voteCount.value;
}

export async function createGame(categoryId: string, livingRoleId: string, deadRoleId: string, missingRoleId: string) {
	const [game] = await Promise.allSettled([
		database.registeredGame.create({
			data: {
				categoryId,
				deadRoleId,
				missingRoleId,
				livingRoleId,
			},
		}),
	]);

	if (game.status == 'rejected') return null;
	return game.value;
}

export async function createPlayer(gameId: string, discordId: string) {
	const [player] = await Promise.allSettled([
		database.player.create({
			data: {
				discordAccount: {
					connectOrCreate: {
						create: {
							discordId: discordId,
						},
						where: {
							discordId: discordId,
						},
					},
				},
				game: {
					connect: {
						id: gameId,
					},
				},
			},
		}),
	]);
	if (player.status == 'rejected') return null;
	return player.value;
}

export async function getCommandID(guild: Guild, commandName: string) {
	await guild.client.application.commands.fetch();
	const command = guild.client.application.commands.cache.find((v) => v.name == commandName);
	return command?.id || null;
}

export async function getAllWithRole(guild: Guild, roleID: string) {
	const result: GuildMember[] = [];
	await guild.members.fetch();
	const users = guild.members.cache.filter((m) => m.roles.cache.get(roleID));
	users.forEach((v) => result.push(v));
	return result;
}

async function getAllEvents(voteCountId: string) {
	const votes = await database.actionEvent.findMany({
		where: {
			voteCountId,
		},
		orderBy: {
			createdAt: 'asc',
		},
		include: {},
	});

	return votes;
}

export type DiscordID = string;
export type Vote = [DiscordID, number];
export type Wagon = Vote[];
export type Event = {
	playerId: DiscordID;
	canVote: boolean;
	canBeVoted: boolean;
	countsForMajority: boolean;
	voteWeight: number;
	isVotingFor?: DiscordID;
};

const createDefaultEvent = (discordId: string): Event => {
	return {
		playerId: discordId,
		canVote: true,
		canBeVoted: true,
		countsForMajority: true,
		voteWeight: 1,
	};
};

async function calculateVoteCount(voteCountId: string) {
	const voteCount: Record<DiscordID, Wagon> = {};
	const currentEvents: Record<DiscordID, Event> = {};
	const majority: string[] = [];

	const getLastEvent = (discordId: DiscordID): Event => {
		if (!currentEvents[discordId]) currentEvents[discordId] = createDefaultEvent(discordId);
		return currentEvents[discordId];
	};

	const allEvents = await getAllEvents(voteCountId);
	for (const e of allEvents) {
		let event = getLastEvent(e.playerId);

		event.canBeVoted = e.canBeVoted !== null ? e.canBeVoted : event.canBeVoted;
		event.canVote = e.canVote !== null ? e.canVote : event.canVote;
		event.voteWeight = e.voteWeight !== null ? e.voteWeight : event.voteWeight;
		event.isVotingFor = e.isVotingFor !== null ? e.isVotingFor : event.isVotingFor;
		event.countsForMajority = e.countsForMajority !== null ? e.countsForMajority : event.countsForMajority;

		if (!event.canBeVoted) delete voteCount[event.playerId];

		if (event.countsForMajority) {
		} else {
		}

		if (event.canVote && event.isVotingFor) {
			const oldWagon = voteCount[event.isVotingFor];
			const voteWeight = event.voteWeight;
			// If already is on wagon. Ignore, otherwise add it.
		} else if (!event.canVote) {
			// Iterate through all wagons. Remove playerID
		}

		currentEvents[e.playerId] = event;
	}
}

// export async function createVoteCountPost(guild: Guild, voteCount: VoteCount) {
// 	const voteCommand = await getCommandID(guild, 'vote');
// 	const unvoteCommand = await getCommandID(guild, 'unvote');
// 	const livingPlayers = await getAllWithRole(guild, voteCount.livingRoleId);
// 	const allVotes = await getAllVotes(voteCount.id);

// 	const members: Record<string, GuildMember> = {};
// 	const wagons: Record<string, string[]> = {};
// 	let notVotingList: string[] = [];

// 	for (let i = 0; i < livingPlayers.length; i++) {
// 		const player = livingPlayers[i];
// 		members[player.id] = player;
// 		notVotingList.push(player.id);
// 	}

// 	for (let i = 0; i < allVotes.length; i++) {
// 		const vote = allVotes[i];
// 		const { authorId, targetId } = vote;

// 		if (targetId) {
// 			if (wagons[targetId]) wagons[targetId] = [];
// 			wagons[targetId].push(authorId);
// 			notVotingList = notVotingList.filter((v) => v != authorId);
// 		}
// 	}

// 	let notVoting = '> ';
// 	notVotingList.forEach((v, index) => {
// 		let name = members[v].user.username;
// 		if (index === 0) notVoting += name;
// 		else notVoting += `, ${name}`;
// 	});
// 	if (notVoting == '> ') notVoting += 'None';

// 	const embed = new EmbedBuilder();
// 	embed.setTitle('Votecount');
// 	embed.setColor(Colors.White);
// 	const voteString = '> None';

// 	embed.addFields(
// 		{
// 			name: 'Commands',
// 			value: `> </vote:${voteCommand}>\n> </unvote:${unvoteCommand}>`,
// 		},
// 		{
// 			name: 'Votes',
// 			value: voteString,
// 		},
// 		{
// 			name: 'Not Voting',
// 			value: notVoting,
// 		}
// 	);

// 	if (voteCount.majority)
// 		embed.setFooter({
// 			text: `With ${livingPlayers.length} alive, it takes ${Math.ceil(livingPlayers.length / 2)} to reach majority\nVotes are locked. Once they are placed, they cannot be changed.`,
// 		});

// 	return embed;
// }

// export async function createOrUpdateVote(voteCount: VoteCount, playerId: string, voted?: string) {
// 	let vote = await database.vote.findFirst({
// 		where: {
// 			voteCountId: voteCount.id,
// 			authorId: playerId,
// 		},
// 	});

// 	if (!vote) {
// 		const newVote = await database.vote.create({
// 			data: {
// 				authorId: playerId,
// 				voteCountId: voteCount.id,
// 				targetId: voted,
// 			},
// 		});

// 		return newVote;
// 	}

// 	const updatedVote = await database.vote.update({
// 		where: {
// 			id: vote.id,
// 		},
// 		data: {
// 			targetId: voted,
// 		},
// 	});

// 	return updatedVote;
// }
