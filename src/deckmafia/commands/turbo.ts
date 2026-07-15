import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { database } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";
import {
  TURBO_GUILD_ID,
  getSirenConfig,
  SIREN_ROLES,
  GAME_STATUS,
  CARD_NAMES,
} from "../turbo/constants";
import { assignRoles, generateFlipEmbed, checkWinCondition } from "../turbo/engine";
import { endDay as turboEndDay, endNight as turboEndNight, endGame } from "../turbo/tick";
import { client } from "../../clients/deckmafia";

const c = new SlashCommandBuilder();
c.setName("turbo")
  .setDescription("Turbo Mafia game commands")
  // --- setup ---
  .addSubcommand((x) =>
    x
      .setName("setup")
      .setDescription("Set up a new Turbo Mafia game")
      .addChannelOption((x) =>
        x
          .setName("thread")
          .setDescription("The existing thread to run the game in")
          .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread)
          .setRequired(true)
      )
      .addIntegerOption((x) =>
        x
          .setName("player_count")
          .setDescription("Total number of players (7+)")
          .setMinValue(7)
          .setRequired(true)
      )
      .addIntegerOption((x) =>
        x
          .setName("day_hours")
          .setDescription("Hours per day phase (default 24)")
          .setMinValue(1)
          .setRequired(false)
      )
      .addIntegerOption((x) =>
        x
          .setName("night_hours")
          .setDescription("Hours per night phase (default 24)")
          .setMinValue(1)
          .setRequired(false)
      )
      .addRoleOption((x) =>
        x
          .setName("alive_role")
          .setDescription("Discord role for alive players")
          .setRequired(true)
      )
  )
  // --- start ---
  .addSubcommand((x) =>
    x.setName("start").setDescription("Start Day 1 and create the vote count")
  )
  // --- night_action ---
  .addSubcommand((x) =>
    x
      .setName("night_action")
      .setDescription("Submit a night action (card, kill, or death curse)")
      .addStringOption((x) =>
        x
          .setName("action")
          .setDescription("Which action to perform")
          .addChoices(
            { name: "Activity Cop", value: "activity_cop" },
            { name: "Babysitter", value: "babysitter" },
            { name: "Victim", value: "victim" },
            { name: "Factional Kill (Siren only)", value: "factional_kill" },
            { name: "Death Curse (Siren only)", value: "death_curse" }
          )
          .setRequired(true)
      )
      .addUserOption((x) =>
        x.setName("target").setDescription("Target player").setRequired(true)
      )
  )
  // --- end ---
  .addSubcommand((x) =>
    x.setName("end").setDescription("Force-end the game")
  )
  // --- hammer ---
  .addSubcommand((x) =>
    x
      .setName("hammer")
      .setDescription("Force end of day (admin override)")
      .addUserOption((x) =>
        x
          .setName("target")
          .setDescription("Player being eliminated")
          .setRequired(true)
      )
  )
  // --- flip ---
  .addSubcommand((x) =>
    x
      .setName("flip")
      .setDescription("Process elimination immediately (admin override)")
      .addUserOption((x) =>
        x
          .setName("target")
          .setDescription("Player being eliminated")
          .setRequired(true)
      )
  )
  // --- resolve ---
  .addSubcommand((x) =>
    x
      .setName("resolve")
      .setDescription("Resolve night actions immediately (admin override)")
  );

export default newSlashCommand({
  data: c,
  guildId: TURBO_GUILD_ID,
  async execute(i: ChatInputCommandInteraction) {
    if (!i.guild) return;

    const sub = i.options.getSubcommand(true);
    switch (sub) {
      case "setup":
        return handleSetup(i);
      case "start":
        return handleStart(i);
      case "night_action":
        return handleNightAction(i);
      case "end":
        return handleEnd(i);
      case "hammer":
        return handleHammer(i);
      case "flip":
        return handleFlip(i);
      case "resolve":
        return handleResolve(i);
    }
  },
});

// ============ SETUP ============
async function handleSetup(i: ChatInputCommandInteraction) {
  if (!i.guild) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const thread = i.options.getChannel("thread", true);
  const playerCount = i.options.getInteger("player_count", true);
  const dayHours = i.options.getInteger("day_hours") ?? 24;
  const nightHours = i.options.getInteger("night_hours") ?? 24;
  const aliveRole = i.options.getRole("alive_role", true);

  if (playerCount < 7) {
    return i.editReply("Need at least 7 players for a Turbo game.");
  }

  const { sirenCount } = getSirenConfig(playerCount);

  const existing = await database.turboGame.findFirst({
    where: { threadId: thread.id, status: { not: "ENDED" } },
  });
  if (existing) {
    return i.editReply("A Turbo game is already running in this thread.");
  }

  const members = await i.guild.members.fetch();
  const aliveMembers = members.filter(
    (m) => m.roles.cache.has(aliveRole.id) && !m.user.bot
  );

  if (aliveMembers.size < playerCount) {
    return i.editReply(
      `Only ${aliveMembers.size} non-bot members have the ${aliveRole.name} role. Need ${playerCount}.`
    );
  }

  const playerIds = aliveMembers.first(playerCount).map((m) => m.id);
  const { sirenMap, sirens } = assignRoles(playerIds, playerCount);

  await database.turboGame.create({
    data: {
      guildId: i.guild.id,
      threadId: thread.id,
      playerCount,
      dayHours,
      nightHours,
      sirens,
      sirenRoles: Object.fromEntries(sirenMap),
      players: {
        create: playerIds.map((discordId) => ({
          discordId,
          alignment: sirens.includes(discordId) ? "SIREN" : "SUBVER",
          sirenRole: sirenMap.get(discordId) || null,
        })),
      },
    },
  });

  // DM Sirens
  for (const sirenId of sirens) {
    try {
      const user = await i.client.users.fetch(sirenId);
      const role = sirenMap.get(sirenId) || "Siren";
      const teammates = sirens
        .filter((id) => id !== sirenId)
        .map((id) => `${sirenMap.get(id) || "Siren"} (<@${id}>)`)
        .join(", ");

      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏴‍☠️ Scarlet Siren")
            .setDescription(`You are **${role}**, a member of the **Scarlet Sirens**.`)
            .addFields(
              { name: "Teammates", value: teammates || "None (you're the only Siren)" },
              { name: "Your cards", value: "Activity Cop, Babysitter, Victim — ONE use each, entire game.\n**Factional Kill** — any Siren can submit each night.\n**Death Curse** — ONE use, marks a player to die when you are eliminated." }
            )
            .setColor(0xff0000),
        ],
      });
    } catch { /* DM failed */ }
  }

  await i.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Turbo Mafia — Setup Complete")
        .addFields(
          { name: "Players", value: `${playerCount}`, inline: true },
          { name: "Sirens", value: `${sirenCount}`, inline: true },
          { name: "Subvers", value: `${playerCount - sirenCount}`, inline: true },
          { name: "Day", value: `${dayHours}h`, inline: true },
          { name: "Night", value: `${nightHours}h`, inline: true }
        )
        .setColor(0x3498db),
    ],
  });

  if (thread.isTextBased()) {
    await thread.send("Turbo Mafia game created. Use `/turbo start` to begin.");
  }
}

// ============ START ============
async function handleStart(i: ChatInputCommandInteraction) {
  if (!i.guild) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const game = await database.turboGame.findFirst({
    where: { threadId: i.channelId, status: "SETUP" },
  });
  if (!game) {
    return i.editReply("No game in SETUP status found in this thread. Use `/turbo setup` first.");
  }

  // Create VoteCount
  const closeAt = new Date(Date.now() + game.dayHours * 60 * 60 * 1000);
  try {
    await database.voteCount.create({
      data: {
        guildId: i.guild.id,
        channelId: game.threadId,
        livingRoleId: "0",
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
    return i.editReply("Failed to create VoteCount. Is there already one in this channel?");
  }

  await database.turboGame.update({
    where: { id: game.id },
    data: { status: GAME_STATUS.DAY, dayNumber: 1 },
  });

  if (i.channel?.isTextBased()) {
    await (i.channel as TextChannel).send({
      content: `☀️ **Day 1 has begun!** You may now vote.\nDay ends <t:${Math.ceil(closeAt.getTime() / 1000)}:R>.`,
    });
  }

  await i.editReply("Game started! Day 1 is live.");
}

// ============ NIGHT ACTION ============
async function handleNightAction(i: ChatInputCommandInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const action = i.options.getString("action", true);
  const target = i.options.getUser("target", true);

  if (target.bot) return i.editReply("Cannot target bots.");
  if (target.id === i.user.id && action !== "victim") {
    return i.editReply("You cannot target yourself with this action.");
  }

  const game = await database.turboGame.findFirst({
    where: { threadId: i.channelId, status: GAME_STATUS.NIGHT },
    include: { players: true },
  });
  if (!game) return i.editReply("No active Turbo game in NIGHT phase found in this thread.");

  const player = game.players.find((p) => p.discordId === i.user.id);
  if (!player || !player.isAlive) return i.editReply("You are not alive in this game.");

  const targetPlayer = game.players.find((p) => p.discordId === target.id);
  if (!targetPlayer || !targetPlayer.isAlive) {
    return i.editReply("Target is not an alive player in this game.");
  }

  // Action validation
  const isSiren = player.alignment === "SIREN";

  switch (action) {
    case "activity_cop": {
      if (player.activityCopUsed) return i.editReply("You have already used Activity Cop this game.");
      if (player.actionSubmittedThisNight) return i.editReply("You already submitted an action tonight.");
      await database.turboPlayer.update({
        where: { id: player.id },
        data: {
          activityCopUsed: true,
          activityCopTarget: target.id,
          actionSubmittedThisNight: true,
        },
      });
      return i.editReply(`🔍 Activity Cop used on **${target.displayName}**.`);
    }
    case "babysitter": {
      if (player.babysitterUsed) return i.editReply("You have already used Babysitter this game.");
      if (player.actionSubmittedThisNight) return i.editReply("You already submitted an action tonight.");
      await database.turboPlayer.update({
        where: { id: player.id },
        data: {
          babysitterUsed: true,
          babysitterTarget: target.id,
          actionSubmittedThisNight: true,
        },
      });
      return i.editReply(`🛡️ Babysitting **${target.displayName}**.`);
    }
    case "victim": {
      if (player.victimUsed) return i.editReply("You have already used Victim this game.");
      if (player.actionSubmittedThisNight) return i.editReply("You already submitted an action tonight.");
      await database.turboPlayer.update({
        where: { id: player.id },
        data: {
          victimUsed: true,
          victimTarget: target.id,
          actionSubmittedThisNight: true,
        },
      });
      return i.editReply(`🎯 Victim used on **${target.displayName}**.`);
    }
    case "factional_kill": {
      if (!isSiren) return i.editReply("Only Scarlet Sirens can use the Factional Kill.");
      // Any Siren can submit, last wins
      await database.turboGame.update({
        where: { id: game.id },
        data: { killTarget: target.id },
      });
      return i.editReply(`🔪 Factional Kill set on **${target.displayName}**.`);
    }
    case "death_curse": {
      if (!isSiren) return i.editReply("Only Scarlet Sirens can use the Death Curse.");
      if (player.deathCurseUsed) return i.editReply("You have already used your Death Curse this game.");
      if (player.actionSubmittedThisNight) return i.editReply("You already submitted an action tonight. Death Curse cannot be used the same night as a card.");

      // Set curse on player, and mark the target
      await database.turboPlayer.update({
        where: { id: player.id },
        data: {
          deathCurseUsed: true,
          deathCurseTarget: target.id,
          actionSubmittedThisNight: true,
        },
      });
      // Mark the target
      await database.turboPlayer.update({
        where: { id: targetPlayer.id },
        data: { deathCurseMarkedBy: player.discordId },
      });
      return i.editReply(`💀 Death Curse placed on **${target.displayName}**. If you are eliminated tomorrow, they will die too.`);
    }
    default:
      return i.editReply("Unknown action.");
  }
}

// ============ END ============
async function handleEnd(i: ChatInputCommandInteraction) {
  if (!i.guild) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const game = await database.turboGame.findFirst({
    where: {
      threadId: i.channelId,
      status: { in: [GAME_STATUS.DAY, GAME_STATUS.NIGHT, GAME_STATUS.SETUP] },
    },
    include: { players: true },
  });
  if (!game) return i.editReply("No active Turbo game found in this thread.");

  // Determine winner based on current state
  const winner = checkWinCondition(game, game.players) || "SUBVER";
  await endGame(client, game, game.players, winner);
  await i.editReply("Game force-ended.");
}

// ============ HAMMER ============
async function handleHammer(i: ChatInputCommandInteraction) {
  if (!i.guild) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const target = i.options.getUser("target", true);
  const game = await database.turboGame.findFirst({
    where: { threadId: i.channelId, status: GAME_STATUS.DAY },
    include: { players: true },
  });
  if (!game) return i.editReply("No active Turbo game in DAY phase found in this thread.");

  // Close current VoteCount
  const vc = await database.voteCount.findUnique({ where: { channelId: game.threadId } });
  if (vc) {
    await database.actionEvent.deleteMany({ where: { voteCountId: vc.id } });
    await database.voteCount.delete({ where: { id: vc.id } });
  }

  await turboEndDay(client, game, target.id);
  await i.editReply(`Hammered. Eliminating ${target.displayName}.`);
}

// ============ FLIP ============
async function handleFlip(i: ChatInputCommandInteraction) {
  if (!i.guild) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const target = i.options.getUser("target", true);
  const game = await database.turboGame.findFirst({
    where: {
      threadId: i.channelId,
      status: { in: [GAME_STATUS.DAY, GAME_STATUS.NIGHT] },
    },
    include: { players: true },
  });
  if (!game) return i.editReply("No active Turbo game found in this thread.");

  await turboEndDay(client, game, target.id);
  await i.editReply(`Processed elimination of ${target.displayName}.`);
}

// ============ RESOLVE ============
async function handleResolve(i: ChatInputCommandInteraction) {
  if (!i.guild) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const game = await database.turboGame.findFirst({
    where: { threadId: i.channelId, status: GAME_STATUS.NIGHT },
    include: { players: true },
  });
  if (!game) return i.editReply("No active Turbo game in NIGHT phase found in this thread.");

  // Set nightEndsAt to now to force resolution
  await database.turboGame.update({
    where: { id: game.id },
    data: { nightEndsAt: new Date() },
  });

  await turboEndNight(client, game);
  await i.editReply("Night actions resolved.");
}