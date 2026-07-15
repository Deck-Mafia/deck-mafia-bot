import { EmbedBuilder } from "@discordjs/builders";
import { ActionEvent, RegisteredGame, VoteCount } from "@prisma/client";
import { time } from "console";
import { Colors, Guild, GuildMember } from "discord.js";
import { mem } from "node-os-utils";
import { listenerCount } from "process";
import { database } from "../..";
import votecount from "../commands/managevotecount";
const isDebug = process.env.DEBUG_MODE === 'true';

export function getNextInterval(): Date {
    // 2 hours in milliseconds
    return new Date(Date.now() + 1000 * 60 * 60 * 2);
}

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

//export async function getAllWithRole(guild: Guild, roleID: string) {
//  const members = await guild.members.fetch(); 
//  return Array.from(members.filter((m) => m.roles.cache.has(roleID)).values());
//}
export async function getAllWithRole(guild: Guild, roleID: string) {
  // This asks Discord: "Give me only the members who have this specific role"
  // Much lighter on the Pi and the API
  const role = await guild.roles.fetch(roleID, { force: true });
  if (!role) return [];
  return Array.from(role.members.values());
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
  privateVoteWeight?: number;
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
 
 export async function calculateVoteCount(  voteCountId: string,  guild: Guild	): Promise<VoteCountResponse | null> {
  const wagons: Record<DiscordID, DiscordID[]> = {};
  const currentStats: Record<DiscordID, Event> = {};
  
  const voteCounter = await database.voteCount.findUnique({
    where: { id: voteCountId },
  });
  if (!voteCounter) return null;

  // 1. Get events first to see who has historical actions
  const allEvents = await getAllEvents(voteCountId);
  
  // 2. TARGETED FETCH: Only fetch players who have actually done something.
  // This prevents the "Opcode 8" crash by not asking for the whole server.
  const relevantUserIds = new Set(allEvents.map(e => e.playerId));
  if (relevantUserIds.size > 0) {
    await guild.members.fetch({ user: Array.from(relevantUserIds) }).catch(() => null);
  }

  // 3. Initialize ONLY real, alive players
  const allPlayerIds = new Set(allEvents.map(e => e.playerId));
  const aliveMembers = await getAllWithRole(guild, voteCounter.livingRoleId);
  
  // Clear and rebuild to ensure we only have valid players
  aliveMembers.forEach(member => {  allPlayerIds.add(member.id);  });
  
	allPlayerIds.forEach(id => {
		if (id === '1061684614797742190') return; 
		
		currentStats[id] = createDefaultEvent(id);
		wagons[id] = []; // Initialize as empty array
	});
  
  // 4. Process the events
  for (let index = 0; index < allEvents.length; index++) {
    const focusEvent = allEvents[index];
    
    // Ensure the player exists in stats (for players who might have lost the role but have events)
    if (!currentStats[focusEvent.playerId]) {
      currentStats[focusEvent.playerId] = createDefaultEvent(focusEvent.playerId);
    }
    if (!wagons[focusEvent.playerId]) wagons[focusEvent.playerId] = [];

    const mutable = currentStats[focusEvent.playerId];
    mutable.canBeVoted = focusEvent.canBeVoted ?? mutable.canBeVoted;
    mutable.canVote = focusEvent.canVote ?? mutable.canVote;
    mutable.countsForMajority = focusEvent.countsForMajority ?? mutable.countsForMajority;
    mutable.voteWeight = focusEvent.voteWeight ?? mutable.voteWeight;
    mutable.privateVoteWeight = focusEvent.privateVoteWeight ?? mutable.privateVoteWeight;
	
	
	// Ensure dead players are properly marked (important fix)
	for (const statKey in currentStats) {
		const stat = currentStats[statKey];
		if (stat.isVotingFor && !currentStats[stat.isVotingFor]) {
			// This is a "Ghost" target (e.g., a dead player or someone without current role)
			// Initialize them just so they exist for the validation check
			currentStats[stat.isVotingFor] = createDefaultEvent(stat.isVotingFor);
		}
	}
	
    if (focusEvent.canBeVoted === false) {
      mutable.canBeVoted = false;
    }

    if (voteCounter.lockedVotes) {
      mutable.isVotingFor = mutable.isVotingFor ?? focusEvent.isVotingFor;
    } else {
      mutable.isVotingFor = focusEvent.isVotingFor ?? mutable.isVotingFor;
      if (focusEvent.isUnvoting) {
        mutable.isVotingFor = null;
      }
      // REMOVED the "return" that was accidentally here previously
    }

    // Update wagons logic
    for (const wagonKey in wagons) {
      const wagon = wagons[wagonKey];
      const targetStats = currentStats[wagonKey];
      if (!targetStats) continue;

      const canBeVoted = targetStats.canBeVoted ?? true;
      const canVote = mutable.canVote;

      if (!mutable.isVotingFor || !canVote) {
        wagons[wagonKey] = wagon.filter((v) => v !== focusEvent.playerId);
      } else if (wagonKey === mutable.isVotingFor) {
        if (!wagon.includes(focusEvent.playerId)) {
          wagons[wagonKey] = [...wagon, focusEvent.playerId];
        }
      } else {
        wagons[wagonKey] = wagon.filter((v) => v !== focusEvent.playerId);
      }

     
	
	  
    }

    // Majority check logic...
    if (voteCounter.majority) {
      let playerCount = 0;
      for (const statKey in currentStats) {
        if (currentStats[statKey].countsForMajority) playerCount += 1;
      }

      const majority = Math.floor(playerCount / 2 + 1);
      let majorityReached = false;
      for (const wagonKey in wagons) {
        let totalWeight = 0;
        for (const voter of wagons[wagonKey]) {
          const stat = currentStats[voter];
          if (stat) {
            totalWeight += (stat.voteWeight ?? 1) + (stat.privateVoteWeight ?? 0);
          } else {
            totalWeight += 1;
          }
        }
        if (totalWeight >= majority) majorityReached = true;
      }

      if (majorityReached) {
        await database.voteCount.update({
          where: { id: voteCounter.id },
          data: { closeAt: new Date(), hammered: true },
        });
        return { wagons, playerStats: currentStats, voteCounter };
      }
    }
  }
  const finalWagons: Record<DiscordID, DiscordID[]> = {};
  for (const key in wagons) {
  	if (wagons[key].length > 0) {
  		finalWagons[key] = wagons[key];
  	}
  }
  
  // Now return the cleaned-up wagons
  return { wagons: finalWagons, playerStats: currentStats, voteCounter };
  
}


export async function createVoteCountPost(
  voteCount: VoteCountResponse,
  guild: Guild,
  isFinal: boolean = false,
) {
  const { wagons, playerStats, voteCounter } = voteCount;

  // 1. Ensure IDs are an array of strings
const userIdsToFetch = Array.from(new Set([
    ...Object.keys(playerStats),
    ...Object.values(playerStats)
        .map(s => s.isVotingFor)
        .filter((id): id is string => id !== null && id !== '1061684614797742190')
]));

// 2. Fetch using the correct signature
if (userIdsToFetch.length > 0) {
    // Simply pass the 'user' array to the fetch options
    await guild.members.fetch({ user: userIdsToFetch }).catch(() => null);
}

  let playerCount = 0;
  const embed = new EmbedBuilder();
  embed.setTitle("VoteCount");
  embed.setThumbnail(guild.iconURL());
  embed.setColor(0xf8f98e);

  if (voteCounter.majority) {
    for (const statKey in playerStats) {
      if (playerStats[statKey].countsForMajority) playerCount += 1;
    }
  }



  // ==================== NON-VOTING PLAYERS  ====================
  const nonVotingPlayers: string[] = [];
  const livingRoleId = voteCounter.livingRoleId;
  if (isDebug) console.log(`[DEBUG] Starting loop. PlayerStats keys: ${Object.keys(playerStats).join(', ')}`);

  for (const statKey in playerStats) {
    const stat = playerStats[statKey];
    if (statKey === '1061684614797742190') continue;

	let member = guild.members.cache.get(stat.playerId);
	if (!member) { 
		member = await guild.members.fetch(stat.playerId).catch(() => null) ?? undefined; 
	} 
	const name = member ? member.displayName : "Unknown";
	const isAlive = !!stat && member?.roles.cache.has(livingRoleId);
	const hasRole = member?.roles.cache.has(livingRoleId);
    if (isDebug) console.log(`[DEBUG] Processing: ${name} (${statKey}) | HasRole: ${hasRole}`); // Log EVERY player	
	if (!hasRole) {
		if (isDebug) console.log(`[DEBUG] Skipping ${name} because HasRole is ${hasRole}`);
		continue; 
	} 
    const targetId = stat.isVotingFor;
	const targetMember = targetId ? guild.members.cache.get(targetId) : null;
    const targetStat = targetId ? playerStats[targetId] : null;
    const isTargetAlive = targetMember?.roles.cache.has(livingRoleId) ?? false;
	
    const isActuallyVoting = targetId && 
                             targetId !== '1061684614797742190' && 
                             isTargetAlive;
    
	// DEBUG: Log why it thinks they are voting
    if (isDebug) {
		 if (isActuallyVoting) {
			console.log(`[DEBUG] ${name} is marked as ACTUALLY VOTING for ${targetMember?.displayName ?? targetId} (isTargetAlive: ${isTargetAlive})`);
		}
	}

    if (!isActuallyVoting) {
        const entry = `\`${name}\` <@${stat.playerId}>`; 
        nonVotingPlayers.push(entry);
        if (isDebug) console.log(`[DEBUG] Pushed to nonVoting: ${name} (Reason: ${!targetId || targetId === '1061684614797742190' ? 'No target' : 'Target dead'})`);
    }
    
  }
  
  // ==================== WAGON CALCULATION ====================
  const wagonLines: string[] = [];
  for (const wagonKey in wagons) {
	const wagon = wagons[wagonKey];
	if (isDebug) console.log(`[DEBUG] Found wagon on ${wagonKey} with ${wagon.length} voters:`, wagon);
	const targetMember = guild.members.cache.get(wagonKey);
	const isTargetAlive = targetMember?.roles.cache.has(voteCounter.livingRoleId);
	if (!isTargetAlive) {
        if (isDebug) console.log(`[DEBUG] Skipping wagon for ${wagonKey} because they are dead.`);
        continue;
    }
	const wagonTop = targetMember?.displayName || `<@${wagonKey}>`;
	const voterNames = wagon.map(id => guild.members.cache.get(id)?.displayName || `<@${id}>`);

		if (wagon.length > 0) {
			// Compute weighted total — public weights always count, private only at EoD
			let weightedCount = 0;
			for (const voterId of wagon) {
				const stat = playerStats[voterId];
				if (stat) {
					weightedCount += (stat.voteWeight ?? 1);
					if (isFinal) {
						weightedCount += (stat.privateVoteWeight ?? 0);
					}
				} else {
					weightedCount += 1;
				}
			}
			wagonLines.push(`**${wagonTop} (${weightedCount})** - ${voterNames.join(", ")}`);
		}
  }
  

  // ==================== FINAL COMPOSITION ====================
  let finalValue = "";
  
  if (nonVotingPlayers.length > 0) {
  // 1. Create a clean list for the display names
  // We use .map to extract just the name from your previous push logic
  const displayNames = nonVotingPlayers.map(entry => {
  // This regex assumes your entry is formatted as `Name` <@ID>
  const match = entry.match(/`(.*?)`/);
  return match ? match[1] : "Unknown";
  });
  
  // 2. Create the spoilered mentions
  // We map to the raw mention <@ID> and join them without commas
  const spoileredMentions = nonVotingPlayers.map(entry => {
  const match = entry.match(/<@(\d+)>/);
  return match ? `<@${match[1]}>` : "";
  });
  // 2. New Test Mentions (Nickname format)
  const spoileredMentionsNickname = nonVotingPlayers.map(entry => {
  const match = entry.match(/<@(\d+)>/);
  return match ? `<@!${match[1]}>` : "";
  });
  if (isDebug) {
  // --- DEBUG LINES ---
	console.log("Display Names Array:", displayNames);
	console.log("Spoilered Mentions Array:", spoileredMentions);
	console.log("Spoilered Mentions Nick Array:", spoileredMentionsNickname);
  }
  // -------------------
  
  //finalValue += `**Not Voting:**\n${spoileredMentionsNickname.join(", ")}\n\n`;
  finalValue += `**Not Voting:**\n${displayNames.join(", ")}\n\n`;
  //finalValue += `-# ||Mentions: ${spoileredMentions.join(" ")}||\n`;
  //finalValue += `-# ||Nickname Format: ${spoileredMentionsNickname.join(" ")}||`;
  }
  
  if (wagonLines.length > 0) {
  finalValue += `\n\n**Votes:**\n${wagonLines.join("\n")}`;
  }
  
  // Ensure it's not empty
  const valueToSet = finalValue.trim() || "`No Votes`";
  if (isDebug) console.log(`[DEBUG] Final string length: ${valueToSet.length}`);
  
  // Use .addFields or .setFields (if you are editing an existing message)
  embed.addFields({ name: "Votes", value: valueToSet });


  const additionalNotes: string[] = [];
  if (voteCounter.majority) {
    const majority = Math.floor(playerCount / 2 + 1);
    additionalNotes.push(`> ${playerCount} alive so ${majority} is Majority`);
  }
  if (voteCount.voteCounter.closeAt) {
    const timestamp = voteCount.voteCounter.closeAt.getTime() - 1000 * 60 * 60;
    additionalNotes.push(`> Action submission deadline <t:${Math.ceil(timestamp / 1000)}:f>`);
  }

  if (additionalNotes.length > 0) {
    embed.addFields({ name: "Other", value: additionalNotes.join("\n") });
  }

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
    isVotingFor: '1061684614797742190',
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
    privateVoteWeight,
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
        privateVoteWeight: privateVoteWeight ?? undefined,
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
