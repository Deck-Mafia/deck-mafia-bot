import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";

const FRAGMENT_CARD_NAME = "fragment";

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
    const fragmentCard = await prisma.card.findFirst({
      where: { name: FRAGMENT_CARD_NAME },
      select: { id: true },
    });

    if (!fragmentCard) {
      return i.editReply({
        content: `**System Error:** The \`${FRAGMENT_CARD_NAME}\` card does not exist in the database. Add it first with \`/add name:fragment url:... rarity:0 public:true\`.`,
      });
    }

    // Ensure the target user has an inventory
    const inventory = await prisma.inventory.upsert({
      where: { discordId: targetUser.id },
      create: { discordId: targetUser.id },
      update: {},
    });

    // Create the requested number of fragment OwnedCards
    const creates = Array.from({ length: amount }, () =>
      prisma.ownedCard.create({
        data: {
          card: { connect: { id: fragmentCard.id } },
          inventory: { connect: { id: inventory.id } },
        },
      })
    );

    await prisma.$transaction(creates);

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
    const fragmentCard = await prisma.card.findFirst({
      where: { name: FRAGMENT_CARD_NAME },
      select: { id: true },
    });

    if (!fragmentCard) {
      return i.editReply({
        content: `**System Error:** The \`${FRAGMENT_CARD_NAME}\` card does not exist in the database.`,
      });
    }

    // Fetch up to `amount` fragments owned by the target user
    const userFragments = await prisma.ownedCard.findMany({
      where: {
        cardId: fragmentCard.id,
        inventory: { discordId: targetUser.id },
      },
      take: amount,
      orderBy: { id: "asc" },
      select: { id: true },
    });

    const removed = userFragments.length;

    if (removed > 0) {
      await prisma.ownedCard.deleteMany({
        where: { id: { in: userFragments.map((f) => f.id) } },
      });
    }

    if (removed === 0) {
      await i.editReply({
        content: `<@${targetUser.id}> has no Fragments to remove. Nothing was changed.`,
      });
    } else if (removed < amount) {
      await i.editReply({
        content: `<@${targetUser.id}> only had **${removed}** Fragment(s), which have all been removed (requested ${amount}). Their Fragments are now zeroed out.`,
      });
    } else {
      await i.editReply({
        content: `Removed **${removed}** Fragment(s) from <@${targetUser.id}>.`,
      });
    }
  } catch (err) {
    console.error("[FRAGMENTS TAKE ERROR]", err);
    await i.editReply({
      content: "An error occurred while removing Fragments.",
    });
  }
}