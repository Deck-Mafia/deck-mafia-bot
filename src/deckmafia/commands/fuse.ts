import {
  ChannelType,
  ChatInputCommandInteraction,
  CommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { database, prisma } from "../..";
import { newSlashCommand, SlashCommand } from "../../structures/SlashCommand";

const c = new SlashCommandBuilder();
c.setName("fuse").setDescription("Fuse commands");

c.addSubcommand((x) =>
  x
    .setName("request")
    .setDescription("Make a request to fuse cards")
    .addStringOption((option) =>
      option
        .setName("card1")
        .setDescription("The first card to fuse")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("card2")
        .setDescription("The second card to fuse")
        .setRequired(true)
    )
);

c.addSubcommand((x) =>
  x
    .setName("done")
    .setDescription(
      "Mark current fuse request as done and move on to the next one (admins only)"
    )
    .addBooleanOption((option) =>
      option
        .setName("accepted")
        .setDescription("Whether the fuse request is accepted or denied")
        .setRequired(true)
    )
);

c.addSubcommand((x) =>
  x
    .setName("setup")
    .setDescription("Set up the request-a-fuse system (admins only)")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel to post the request in")
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName("fusestatuschannel")
        .setDescription(
          "The channel to post whether the request was accepted or not"
        )
        .setRequired(true)
    )
);

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    if (!i.guild) return;

    switch (i.options.getSubcommand(true)) {
      case "request":
        await handleRequest(i);
        break;

      case "done":
        await handleDone(i);
        break;

      case "setup":
        await handleSetup(i);
        break;

      default:
        return;
    }
  },
});

async function handleRequest(i: ChatInputCommandInteraction) {
  const existingQueueEntry = await prisma.fuseQueue.findMany({
    where: {
      userId: i.user.id,
    },
  });

  if (existingQueueEntry.length > 0) {
    return i.reply({
      content: "You are already in the fuse queue. Please wait for your turn.",
      ephemeral: true,
    });
  }

  const queuePosition = await prisma.fuseQueue.count();

  const cardName1 = i.options.getString("card1", true);
  const cardName2 = i.options.getString("card2", true);

  await prisma.fuseQueue.create({
    data: {
      userId: i.user.id,
      position: queuePosition + 1,
    },
  });

  const channel = await prisma.fuseSystem.findUnique({
    where: {
      //@ts-ignore
      guildId: i.guild.id,
    },
  });

  if (!channel) {
    return i.reply({
      content:
        "The fuse system has not been set up. Contact an administrator to set it up.",
      ephemeral: true,
    });
  }
  //@ts-ignore
  const notificationChannel = i.guild.channels.cache.get(
    channel.channelId
  ) as TextChannel;

  if (!notificationChannel) {
    return i.reply({
      content:
        "The specified notification channel does not exist. Contact an administrator to set it up.",
      ephemeral: true,
    });
  }

  if (queuePosition === 0) {
    const embed = new EmbedBuilder()
      .setTitle("Fuse Request")
      .setDescription(
        `User <@${i.user.id}> has requested to fuse cards \`${cardName1}\` and \`${cardName2}\`. Respond to the request using \`/fuse done\``
      )
      .setColor("Blue");

    await notificationChannel.send({ embeds: [embed] });
  }

  return i.reply({
    content: `You have been added to the fuse queue. Your position is ${
      queuePosition + 1
    }.`,
  });
}

async function handleDone(i: ChatInputCommandInteraction) {
  const member = i.guild?.members.cache.get(i.user.id);
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return i.reply({
      content: "You must be an administrator to use this command.",
      ephemeral: true,
    });
  }

  const acceptedOption = i.options.getBoolean("accepted", true);

  const [nextInQueue] = await prisma.fuseQueue.findMany({
    take: 1,
    orderBy: {
      position: "asc",
    },
  });

  if (!nextInQueue) {
    return i.reply({
      content: "There are no users in the fuse queue.",
      ephemeral: true,
    });
  }

  const completedPosition = nextInQueue.position;

  await prisma.fuseQueue.deleteMany({
    where: {
      userId: nextInQueue.userId,
    },
  });

  await prisma.fuseQueue.updateMany({
    where: {
      position: {
        gt: completedPosition,
      },
    },
    data: {
      position: {
        decrement: 1,
      },
    },
  });

  const [newNextInQueue] = await prisma.fuseQueue.findMany({
    take: 1,
    orderBy: {
      position: "asc",
    },
  });

  const fuseSystem = await prisma.fuseSystem.findUnique({
    where: {
      guildId: i.guild?.id,
    },
  });

  if (!fuseSystem) {
    return i.reply({
      content:
        "The fuse system has not been set up. Contact an administrator to set it up.",
      ephemeral: true,
    });
  }

  const statusChannel = i.guild?.channels.cache.get(
    fuseSystem.statusChannelId
  ) as TextChannel;

  if (!statusChannel) {
    return i.reply({
      content:
        "The specified status channel does not exist. Contact an administrator to set it up.",
      ephemeral: true,
    });
  }

  let decisionMessage = "";
  if (acceptedOption) {
    decisionMessage = `The fuse request for <@${nextInQueue.userId}> has been accepted and processed successfully.`;
  } else {
    decisionMessage = `The fuse request for <@${nextInQueue.userId}> has been denied. `;
  }

  const replyContent = newNextInQueue
    ? `You responded to the request! The next user in the queue is now <@${newNextInQueue.userId}>.`
    : `You responded to the request! There are no users in the queue.`;

  const decisionEmbed = new EmbedBuilder()
    .setTitle("Fuse Decision")
    .setDescription(decisionMessage)
    .setColor(acceptedOption ? "Green" : "Red");

  await statusChannel.send({
    content: `<@${nextInQueue.userId}>`,
    embeds: [decisionEmbed],
  });

  return i.reply({
    content: replyContent,
  });
}

async function handleSetup(i: ChatInputCommandInteraction) {
  //@ts-ignore
  const member = i.guild.members.cache.get(i.user.id);
  if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
    return i.reply({
      content: "You must be an administrator to use this command.",
      ephemeral: true,
    });
  }

  const existingFuseSystem = await database.fuseSystem.findUnique({
    where: {
      //@ts-ignore
      guildId: i.guild.id,
    },
  });

  if (existingFuseSystem) {
    return i.reply({
      content: "The fuse system is already set up for this guild.",
      ephemeral: true,
    });
  }

  const channel = i.options.getChannel("channel", true);
  const stausChannel = i.options.getChannel("fusestatuschannel", true);

  await database.fuseSystem.create({
    data: {
      //@ts-ignore
      guildId: i.guild.id,
      channelId: channel.id,
      statusChannelId: stausChannel.id,
    },
  });

  return i.reply({
    content: `The fuse system has been set up. Fuse requests will be posted in ${channel.toString()}.`,
    ephemeral: true,
  });
}
