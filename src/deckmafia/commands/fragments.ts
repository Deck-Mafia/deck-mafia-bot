import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";

const c = new SlashCommandBuilder();
c.setName("fragments");
c.setDescription("Give or take Fragments from a user (Admin only)");
c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

c.addSubcommand((sub) =>
  sub
    .setName("give")
    .setDescription("Give Fragments to a user")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("User to give Fragments to")
        .setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Number of Fragments to give")
        .setRequired(true)
        .setMinValue(1)
    )
);

c.addSubcommand((sub) =>
  sub
    .setName("take")
    .setDescription("Remove Fragments from a user (zeros out if not enough)")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("User to remove Fragments from")
        .setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Number of Fragments to remove")
        .setRequired(true)
        .setMinValue(1)
    )
);

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    if (!i.guild) return;

    // Admin permission check
    //@ts-ignore
    const member = i.guild.members.cache.get(i.user.id);
    if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return i.reply({
        content: "You must be an administrator to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = i.options.getSubcommand(true);

    switch (subcommand) {
      case "give":
        await handleGive(i);
        break;
      case "take":
        await handleTake(i);
        break;
    }
  },
});

async function handleGive(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const amount = i.options.getInteger("amount", true);

  await i.deferReply();

  try {
    // Atomic upsert: create the balance row if it doesn't exist, increment if it does
    await prisma.fragmentBalance.upsert({
      where: { discordId: targetUser.id },
      create: { discordId: targetUser.id, amount },
      update: { amount: { increment: amount } },
    });

    await i.editReply({
      content: `Gave **${amount}** Fragment(s) to <@${targetUser.id}>.`,
    });
  } catch (err) {
    console.error("[FRAGMENTS GIVE ERROR]", err);
    await i.editReply({
      content: "An error occurred while giving Fragments.",
    });
  }
}

async function handleTake(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const amount = i.options.getInteger("amount", true);

  await i.deferReply();

  try {
    // Fetch current balance
    const balance = await prisma.fragmentBalance.findUnique({
      where: { discordId: targetUser.id },
      select: { amount: true },
    });

    const currentAmount = balance?.amount ?? 0;

    if (currentAmount === 0) {
      return i.editReply({
        content: `<@${targetUser.id}> has no Fragments to remove. Nothing was changed.`,
      });
    }

    const toRemove = Math.min(currentAmount, amount);

    if (toRemove === currentAmount) {
      // Removing all fragments — just delete the row
      await prisma.fragmentBalance.delete({
        where: { discordId: targetUser.id },
      });
    } else {
      // Partial removal
      await prisma.fragmentBalance.update({
        where: { discordId: targetUser.id },
        data: { amount: { decrement: toRemove } },
      });
    }

    if (toRemove < amount) {
      await i.editReply({
        content: `<@${targetUser.id}> only had **${toRemove}** Fragment(s), which have all been removed (requested ${amount}). Their Fragments are now zeroed out.`,
      });
    } else {
      await i.editReply({
        content: `Removed **${toRemove}** Fragment(s) from <@${targetUser.id}>.`,
      });
    }
  } catch (err) {
    console.error("[FRAGMENTS TAKE ERROR]", err);
    await i.editReply({
      content: "An error occurred while removing Fragments.",
    });
  }
}