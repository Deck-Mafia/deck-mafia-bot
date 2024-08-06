import { EmbedBuilder } from "@discordjs/builders";
import { ActionEvent, RegisteredGame, VoteCount } from "@prisma/client";
import { time } from "console";
import { Colors, Guild, GuildMember } from "discord.js";
import { mem } from "node-os-utils";
import { listenerCount } from "process";
import { database } from "../..";
import votecount from "../commands/managevotecount";

export async function checkGameInCategory(categoryId: string) {
  const [game] = await Promise.allSettled([
    database.registeredGame.findUnique({
      where: {
        categoryId: categoryId,
      },
    }),
  ]);

  if (game.status == "rejected") return null;
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

  if (voteCount.status == "rejected") return null;
  return voteCount.value;
}

export async function createGame(
  categoryId: string,
  livingRoleId: string,
  deadRoleId: string,
  missingRoleId: string
) {
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

  if (game.status == "rejected") return null;
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
  if (player.status == "rejected") return null;
  return player.value;
}

export async function getCommandID(guild: Guild, commandName: string) {
  await guild.client.application.commands.fetch();
  const command = guild.client.application.commands.cache.find(
    (v) => v.name == commandName
  );
  return command?.id || null;
}

export async function getAllWithRole(guild: Guild, roleID: string) {
  const result: GuildMember[] = [];
  await guild.members.fetch();
  const users = guild.members.cache.filter((m) => m.roles.cache.get(roleID));
  users.forEach((v) => result.push(v));
  return result;
}

async function getAllEvents(voteCountId: string): Promise<ActionEvent[]> {
  const votes = await database.actionEvent.findMany({
    where: {
      voteCountId,
    },
    orderBy: {
      createdAt: "asc",
    },
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
  isVotingFor: DiscordID | null;
  isUnvoting: boolean;
  createdAt: Date;
};
export type EventPartial = Partial<Event>;

type VoteCountResponse = {
  wagons: Record<DiscordID, DiscordID[]>;
  playerStats: Record<DiscordID, Event>;
  voteCounter: VoteCount;
};
export async function calculateVoteCount(
  voteCountId: string
): Promise<VoteCountResponse | null> {
  const wagons: Record<DiscordID, DiscordID[]> = {};
  const currentStats: Record<DiscordID, Event> = {};

  const voteCounter = await database.voteCount.findUnique({
    where: { id: voteCountId },
  });
  const allEvents = await getAllEvents(voteCountId);
  if (!voteCounter) return null;

  for (let index = 0; index < allEvents.length; index++) {
    const focusEvent = allEvents[index];
    if (!wagons[focusEvent.playerId]) wagons[focusEvent.playerId] = [];
    if (!currentStats[focusEvent.playerId])
      currentStats[focusEvent.playerId] = createDefaultEvent(
        focusEvent.playerId
      );

    const mutable = currentStats[focusEvent.playerId];
    mutable.canBeVoted = focusEvent.canBeVoted ?? mutable.canBeVoted;
    mutable.canVote = focusEvent.canVote ?? mutable.canVote;
    mutable.countsForMajority =
      focusEvent.countsForMajority ?? mutable.countsForMajority;
    mutable.voteWeight = focusEvent.voteWeight ?? mutable.voteWeight;

    if (voteCounter.lockedVotes) {
      mutable.isVotingFor = mutable.isVotingFor ?? focusEvent.isVotingFor;
    } else {
      mutable.isVotingFor = focusEvent.isVotingFor ?? mutable.isVotingFor;
      if (focusEvent.isUnvoting) {
        mutable.isVotingFor = null;
      }
    }

    for (const wagonKey in wagons) {
      const wagon = wagons[wagonKey];
      const canBeVoted = currentStats[wagonKey].canBeVoted;
      const canVote = currentStats[focusEvent.playerId].canVote;

      if (!mutable.isVotingFor || !(canBeVoted && canVote)) {
        if (wagons[wagonKey].includes(focusEvent.playerId))
          wagons[wagonKey] = wagon.filter((v) => v != focusEvent.playerId);
        if (!canBeVoted) delete wagons[wagonKey];
      } else {
        if (wagonKey === mutable.isVotingFor) {
          if (!wagon.includes(focusEvent.playerId))
            wagons[wagonKey] = [...wagon, focusEvent.playerId];
        } else {
          wagons[wagonKey] = wagon.filter((v) => v != focusEvent.playerId);
        }
      }
    }

    if (voteCounter.majority) {
      let playerCount = 0;
      for (const statKey in currentStats) {
        const stat = currentStats[statKey];
        if (stat.countsForMajority) playerCount += 1;
      }

      const majority = Math.floor(playerCount / 2 + 1);
      let majorityReached: boolean = false;
      for (const wagonKey in wagons) {
        const wagon = wagons[wagonKey];
        let totalVoteWeight = 0;
        for (const voter of wagon) {
          const stats = currentStats[voter];
          if (stats) totalVoteWeight += stats.voteWeight ?? 1;
        }
        if (totalVoteWeight >= majority) majorityReached = true;
      }

      if (majorityReached)
        return {
          wagons,
          playerStats: currentStats,
          voteCounter,
        };
    }
  }
  return { wagons, playerStats: currentStats, voteCounter };
}

export async function createVoteCountPost(
  voteCount: VoteCountResponse,
  guild: Guild
) {
  const { wagons, playerStats, voteCounter } = voteCount;
  await guild.members.fetch();
  let playerCount = 0;

  const embed = new EmbedBuilder();
  embed.setTitle("VoteCount");

  embed.setThumbnail(guild.iconURL());
  embed.setColor(0xf8f98e);

  if (voteCount.voteCounter.majority) {
    for (const statKey in playerStats) {
      const stat = playerStats[statKey];
      if (stat.countsForMajority) playerCount += 1;
    }
  }

  let totalString = "";

 /* const aliveRoleId = voteCounter.livingRoleId;

  const aliveRole = guild.roles.cache.get(aliveRoleId);
*/
  const nonVotingPlayers: string[] = [];
/*  const allPlayers = Array.from(guild.members.cache.keys());
  const voters = Object.keys(wagons);
  const nonVoters = allPlayers.filter(
    //@ts-ignore
    (player) => !voters.includes(player) && aliveRole.members.has(player)
  );


  if (nonVoters.length > 0) {
    nonVoters.forEach((nonVoter) => {
      const nonVoterMember = guild.members.cache.get(nonVoter);
      if (nonVoterMember) nonVotingPlayers.push(nonVoterMember.displayName);
      else nonVotingPlayers.push(`<@${nonVoter}>`);
    });
*/
  for (const statKey in playerStats) {
    const stat = playerStats[statKey];
    if (stat.isVotingFor === null) nonVotingPlayers.push(stat.playerId);
  }
    totalString += `**Non-voting players:** *${nonVotingPlayers.join(
      ", "
    )}*\n\n`;
  }

  if (Object.keys(wagons).length === 0) {
    totalString += "`No Votes`";
  } else {
    for (const wagonKey in wagons) {
      const wagon = wagons[wagonKey];
      const target = guild.members.cache.get(wagonKey);
      const wagonTop = target?.displayName || `<@${wagonKey}>`;
      const wagonNames: string[] = [];
      let totalVoteWeight = 0;
      for (const name of wagon) {
        const stat = playerStats[name];
        totalVoteWeight += stat?.voteWeight ?? 1;
        const target = guild.members.cache.get(name);
        if (!target) wagonNames.push(`<@${name}>`);
        else wagonNames.push(target.displayName);
      }

      const wagonString =
        `**${wagonTop} (${totalVoteWeight})** - ${wagonNames.join(
          ", "
        )}`.trim();

      if (wagonString != "" && totalVoteWeight > 0)
        totalString += `\n${wagonString}\n`;
    }
  }

  console.log(voteCount.voteCounter.closeAt);

  embed.addFields({
    name: "Votes",
    value: totalString,
  });

  const additionalNotes: string[] = [];

  if (voteCounter.majority) {
    const majority = Math.floor(playerCount / 2 + 1);
    additionalNotes.push(`> ${playerCount} alive so ${majority} is Majority`);
  }

  if (voteCount.voteCounter.closeAt) {
    const timestamp = voteCount.voteCounter.closeAt.getTime() - 1000 * 60 * 60;
    additionalNotes.push(
      `> Action submission deadline <t:${Math.ceil(timestamp / 1000)}:f>`
    );
  }

  const totalAdditionalNotes = additionalNotes.join("\n");
  if (totalAdditionalNotes != "")
    embed.addFields({
      name: "Other",
      value: totalAdditionalNotes,
    });

  return embed;
}

const createDefaultEvent = (discordId: string): Event => {
  return {
    playerId: discordId,
    canVote: true,
    canBeVoted: true,
    countsForMajority: true,
    voteWeight: 1,
    isUnvoting: false,
    isVotingFor: null,
    createdAt: new Date(Date.now()),
  };
};

export async function createNewEvent(voteCountId: string, event: EventPartial) {
  const {
    canBeVoted,
    canVote,
    countsForMajority,
    playerId,
    voteWeight,
    isVotingFor,
    isUnvoting,
    createdAt,
  } = event;

  if (!playerId) return null;

  try {
    const voteCounter = await database.voteCount.findUnique({
      where: {
        id: voteCountId,
      },
    });

    if (!voteCounter) return null;

    const updatedVoters = isUnvoting
      ? voteCounter.voters.filter((voter) => voter !== playerId)
      : [...voteCounter.voters, playerId];

    const e = await database.actionEvent.create({
      data: {
        playerId,
        voteCountId: voteCounter.id,
        canBeVoted: canBeVoted ?? undefined,
        canVote: canVote ?? undefined,
        isVotingFor: isVotingFor ?? undefined,
        voteWeight: voteWeight ?? undefined,
        countsForMajority: countsForMajority ?? undefined,
        isUnvoting: isUnvoting ?? undefined,
        createdAt: createdAt ? new Date(createdAt) : undefined,
      },
    });

    await database.voteCount.update({
      where: {
        id: voteCounter.id,
      },
      data: {
        voters: updatedVoters,
      },
    });

    return e;
  } catch (err) {
    console.log(err);
    return null;
  }
}
