import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { database } from "../..";
import { checkWinCondition, generateFlipEmbed, resolveNightActions } from "./engine";
import { GAME_STATUS } from "./constants";
import { TurboGame } from "@prisma/client";
import { calculateVoteCount } from "../util/voteCount";

/**
 * Turbo tick: processes active TurboGames every 10s.
 * - DAY: checks if VoteCount deadline is imminent, captures elimination target before VC deletes itself
 * - NIGHT: detects night end, resolves actions
 */
export async function tickTurboGames(client: Client): Promise<void> {
  const activeGames = await database.turboGame.findMany({
    where: { status: { in: [GAME_STATUS.DAY, GAME_STATUS.NIGHT] } },
    include: { players: true },
  });

  for (const game of activeGames) {
    try {
      if (game.status === GAME_STATUS.DAY) {
        await processDayTick(client, game);
      } else if (game.status === GAME_STATUS.NIGHT) {
        await processNightTick(client, game);
      }
    } catch (err) {
      console.error(`[TurboTick] Error processing game ${game.id}:`, err);
    }
  }
}

async function processDayTick(client: Client, game: TurboGame & { players: any[] }): Promise<void> {
  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  // Check if VoteCount still exists and is active
  const voteCount = await database.voteCount.findUnique({
    where: { channelId: game.threadId },
  });

  if (!voteCount || !voteCount.active) {
    // VoteCount is gone/inactive — day ended but we need the elimination target
    // The elimination target should have been stored on the game record
    // by a prior tick iteration (see below: pre-close detection)
    // If it wasn't stored, we skip (admin should /turbo hammer instead)
    return; // endDay will be called by the pre-close path instead
  }

  // Pre-close detection: if VoteCount is about to close (closeAt in past),
  // capture the elimination target BEFORE checkOnClose deletes everything
  if (voteCount.closeAt && new Date() >= voteCount.closeAt) {
    const vcResult = await calculateVoteCount(voteCount.id, guild);
    if (!vcResult) return;

    // Find the player with the most votes
    let topWagon: string | null = null;
    let topWagonSize = 0;
    for (const [targetId, voters] of Object.entries(vcResult.wagons)) {
      if (voters.length > topWagonSize) {
        topWagonSize = voters.length;
        topWagon = targetId;
      }
    }

    if (!topWagon) return;

    // Store the elimination target on the game record
    // This persists even after checkOnClose deletes the VoteCount
    await database.turboGame.update({
      where: { id: game.id },
      data: {
        // We use a temporary store: set killTarget to the eliminated player's ID
        // This field gets reused as "eliminationTarget" during day
        killTarget: topWagon,
      },
    });

    // Now call endDay
    await endDay(client, game, topWagon);
  }
}

async function processNightTick(client: Client, game: TurboGame & { players: any[] }): Promise<void> {
  if (!game.nightEndsAt) return;

  if (new Date() >= game.nightEndsAt) {
    await endNight(client, game);
  }
}

export async function endDay(client: Client, game: TurboGame & { players: any[] }, eliminatedId: string): Promise<void> {
  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  const thread = await guild.channels.fetch(game.threadId).catch(() => null);
  if (!thread?.isTextBased()) return;

  const players = game.players;
  const eliminated = players.find((p: any) => p.discordId === eliminatedId);
  if (!eliminated) return;

  // Mark eliminated player as dead
  await database.turboPlayer.update({
    where: { id: eliminated.id },
    data: { isAlive: false },
  });

  // Process Death Curse: if a living player was cursed by this eliminated Siren, they die too
  const cursed = players.find(
    (p: any) => p.isAlive && p.deathCurseMarkedBy === eliminated.discordId
  );
  if (cursed) {
    await database.turboPlayer.update({
      where: { id: cursed.id },
      data: { isAlive: false },
    });
  }

  // Track first dead Siren for Isis inheritance
  if (
    eliminated.alignment === "SIREN" &&
    !game.firstDeadSiren
  ) {
    await database.turboGame.update({
      where: { id: game.id },
      data: { firstDeadSiren: eliminated.discordId },
    });
  }

  // Publish flip info
  const flip = generateFlipEmbed(eliminated);
  const flipEmbed = new EmbedBuilder()
    .setTitle(`Day ${game.dayNumber} Elimination`)
    .setDescription(`<@${eliminated.discordId}> has been eliminated!`)
    .addFields(
      { name: "Alignment", value: flip.alignment, inline: true },
      { name: "Cards", value: flip.cards.join(", "), inline: true },
      { name: "Cards Used", value: flip.cardsUsed.length > 0 ? flip.cardsUsed.join(", ") : "None", inline: true }
    )
    .setColor(0xff0000);

  await (thread as TextChannel).send({ embeds: [flipEmbed] });

  // If cursed player also died, announce
  if (cursed) {
    await (thread as TextChannel).send({
      content: `☠️ <@${cursed.discordId}> has also died from the Death Curse!`,
    });
  }

  // Check win condition
  const updatedPlayers = await database.turboPlayer.findMany({
    where: { gameId: game.id },
  });
  const updatedGame = await database.turboGame.findUnique({
    where: { id: game.id },
  });
  if (!updatedGame) return;

  const winner = checkWinCondition(updatedGame, updatedPlayers);
  if (winner) {
    await endGame(client, updatedGame, updatedPlayers, winner);
    return;
  }

  // Start night
  await database.turboGame.update({
    where: { id: game.id },
    data: {
      status: GAME_STATUS.NIGHT,
      nightEndsAt: new Date(Date.now() + game.nightHours * 60 * 60 * 1000),
      killTarget: null, // Clear elimination target after transition
    },
  });

  await (thread as TextChannel).send({
    content: `🌙 **Night ${game.dayNumber} has begun!** Use \`/turbo night_action\` to submit your actions.\nNight ends <t:${Math.ceil((Date.now() + game.nightHours * 60 * 60 * 1000) / 1000)}:R>.`,
  });
}

export async function endNight(client: Client, game: TurboGame & { players: any[] }): Promise<void> {
  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  const thread = await guild.channels.fetch(game.threadId).catch(() => null);
  if (!thread?.isTextBased()) return;

  const updatedGame = await database.turboGame.findUnique({
    where: { id: game.id },
    include: { players: true },
  });
  if (!updatedGame) return;

  // Resolve night actions
  const result = resolveNightActions(updatedGame, updatedGame.players);

  // Process kills
  for (const killId of result.kills) {
    const victim = updatedGame.players.find((p) => p.discordId === killId);
    if (victim && victim.isAlive) {
      await database.turboPlayer.update({
        where: { id: victim.id },
        data: { isAlive: false },
      });
    }
  }

  // Send Activity Cop feedback via DM
  for (const report of result.activityCopReports) {
    try {
      const user = await client.users.fetch(report.playerId);
      const status = report.leftHome ? "**did** leave home" : "did **not** leave home";
      await user.send({
        content: `🔍 **Activity Cop Result**\nYour target (<@${report.targetId}>) ${status} last night.`,
      }).catch(() => {
        // DM failed (user has DMs closed), skip
      });
    } catch {
      // User fetch failed, skip
    }
  }

  // Track first dead Siren for Isis inheritance (night kills)
  const latestPlayers = await database.turboPlayer.findMany({
    where: { gameId: game.id },
  });
  const latestGame = await database.turboGame.findUnique({
    where: { id: game.id },
  });
  if (!latestGame) return;

  if (!latestGame.firstDeadSiren) {
    const deadSiren = latestPlayers.find(
      (p) => p.alignment === "SIREN" && !p.isAlive
    );
    if (deadSiren) {
      await database.turboGame.update({
        where: { id: game.id },
        data: { firstDeadSiren: deadSiren.discordId },
      });
    }
  }

  // Post dawn report
  const dawnEmbed = new EmbedBuilder()
    .setTitle(`Dawn of Day ${(latestGame.dayNumber) + 1}`)
    .setColor(0xffaa00);

  if (result.kills.length > 0) {
    dawnEmbed.setDescription(
      `The following players died last night:\n${result.kills.map((id: string) => `<@${id}>`).join("\n")}`
    );
  } else {
    dawnEmbed.setDescription("No one died last night.");
  }

  await (thread as TextChannel).send({ embeds: [dawnEmbed] });

  // Check win condition
  const winner = checkWinCondition(latestGame, latestPlayers);
  if (winner) {
    await endGame(client, latestGame, latestPlayers, winner);
    return;
  }

  // Transition to next day
  const newDayNumber = latestGame.dayNumber + 1;
  await database.turboGame.update({
    where: { id: game.id },
    data: {
      status: GAME_STATUS.DAY,
      dayNumber: newDayNumber,
      nightEndsAt: null,
      killTarget: null,
    },
  });

  // Reset per-night gates
  await database.turboPlayer.updateMany({
    where: { gameId: game.id },
    data: { actionSubmittedThisNight: false },
  });

  // Create new VoteCount for the day
  try {
    const closeAt = new Date(Date.now() + latestGame.dayHours * 60 * 60 * 1000);
    await database.voteCount.create({
      data: {
        guildId: game.guildId,
        channelId: game.threadId,
        livingRoleId: "0", // Default — admin should configure this per-game
        majority: true,
        plurality: true,
        lockedVotes: false,
        closeAt,
        lastPeriod: new Date(Date.now() + 1000 * 60 * 60 * 2),
        active: true,
        voters: [],
      },
    });
  } catch (err) {
    console.error(`[Turbo] Failed to create VoteCount for game ${game.id}:`, err);
  }

  await (thread as TextChannel).send({
    content: `☀️ **Day ${newDayNumber} has begun!** You may now vote.`,
  });
}

export async function endGame(
  client: Client,
  game: TurboGame,
  players: any[],
  winner: "SIRENS" | "SUBVER"
): Promise<void> {
  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  const thread = await guild.channels.fetch(game.threadId).catch(() => null);
  if (!thread?.isTextBased()) return;

  await database.turboGame.update({
    where: { id: game.id },
    data: { status: GAME_STATUS.ENDED, winner },
  });

  const winnerEmbed = new EmbedBuilder()
    .setTitle("Game Over!")
    .setDescription(
      winner === "SIRENS"
        ? "🏴‍☠️ **The Scarlet Sirens have won!**"
        : "🛡️ **The Subvers have won!**"
    )
    .setColor(winner === "SIRENS" ? 0xff0000 : 0x00ff00);

  const sirenPlayers = players.filter((p: any) => p.alignment === "SIREN");
  const subverPlayers = players.filter((p: any) => p.alignment === "SUBVER");

  winnerEmbed.addFields(
    {
      name: "Scarlet Sirens",
      value: sirenPlayers.map((p: any) => `<@${p.discordId}> (${p.sirenRole || "Siren"})`).join("\n") || "None",
      inline: true,
    },
    {
      name: "Subvers",
      value: subverPlayers.map((p: any) => `<@${p.discordId}>`).join("\n") || "None",
      inline: true,
    }
  );

  await (thread as TextChannel).send({ embeds: [winnerEmbed] });

  // Award 1 Fragment to each winner
  const winnerIds = winner === "SIRENS"
    ? sirenPlayers.map((p: any) => p.discordId)
    : subverPlayers.map((p: any) => p.discordId);

  for (const discordId of winnerIds) {
    try {
      await database.fragmentBalance.upsert({
        where: { discordId },
        update: { amount: { increment: 1 } },
        create: { discordId, amount: 1 },
      });
    } catch (err) {
      console.error(`[Turbo] Failed to award fragment to ${discordId}:`, err);
    }
  }

  await (thread as TextChannel).send({
    content: `🎁 Winners have been awarded **1 Fragment** each!`,
  });
}