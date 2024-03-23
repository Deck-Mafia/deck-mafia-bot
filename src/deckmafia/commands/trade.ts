import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";
import card from "./card";

const c = new SlashCommandBuilder();
c.setName("trade");
c.setDescription("View all the trade commands!");
c.addSubcommand((x) =>
  x.setName("request").setDescription("Request a trade to trade cards")
);

c.addSubcommand((x) =>
  x
    .setName("setup")
    .setDescription("Set up the trade category")
    .addChannelOption((option) =>
      option
        .setName("category")
        .setDescription(
          "Select the parent where the trade channel should be created."
        )
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)
    )
    .addRoleOption((option) =>
      option

        .setName("everyone")
        .setDescription("Select the @everyone role")
        .setRequired(true)
    )
);

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    switch (i.options.getSubcommand(true)) {
      case "request":
        try {
          const serverId = i.guild?.id;
          const userId = i.user.id;

          const tradeSetup = await prisma.tradeSetup.findFirst({
            where: { serverId: serverId },
          });

          if (!tradeSetup) {
            return i.reply({
              ephemeral: true,
              content:
                "Trade setup is not configured for this server. Contact an admin.",
            });
          }

          const inventory = await prisma.inventory.findUnique({
            where: { discordId: userId },
            include: {
              ownedCards: {
                select: {
                  cardId: true,
                  card: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          });

          const existingRequest = await prisma.tradeRequest.findFirst({
            where: {
              userId: i.user.id,
              serverId: serverId,
            },
          });

          if (existingRequest) {
            return i.reply({
              ephemeral: true,
              content:
                "A trade request for one or more of these cards already exists.",
            });
          }

          await i.deferReply({ ephemeral: true });

          const tradeRequest = await prisma.tradeRequest.create({
            data: {
              userId: userId,
              //@ts-ignore
              card1Name: "",
              //@ts-ignore
              card2Name: "",
              //@ts-ignore
              card3Name: "",
              //@ts-ignore
              serverId: serverId,
              //@ts-ignore
              channelId: i.channel?.id,
              messageId: "",
            },
          });

          const message = await i.channel?.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("Trade Request")
                .setDescription(`${i.user.username} is looking to trade cards!`)
                .addFields({ name: "User", value: `<@${userId}>` })
                .setColor("Blue")
                .setTimestamp(),
            ],
            components: [
              new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                  .setCustomId(`trade_request_${tradeRequest.id}`)
                  .setLabel("Click to Trade")
                  .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                  .setCustomId(`trade_delete_${tradeRequest.id}`)
                  .setLabel("Delete")
                  .setStyle(ButtonStyle.Danger)
              ),
            ],
          });

          await prisma.tradeRequest.update({
            where: { id: tradeRequest.id },
            //@ts-ignore
            data: { channelId: i.channel?.id, messageId: message.id },
          });

          await i.editReply({
            content: "Trade request created successfully!",
            //@ts-ignore
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
        }
        break;

      case "setup":
        try {
          const serverId = i.guild?.id;
          const category = i.options.getChannel("category");
          const everyone = i.options.getRole("everyone");
          //@ts-ignore
          const member = i.guild.members.cache.get(i.user.id);
          if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return i.reply({
              content: "You must be an administrator to use this command.",
              ephemeral: true,
            });
          }

          const existingSetup = await prisma.tradeSetup.findFirst({
            where: { serverId: serverId },
          });

          if (existingSetup) {
            await prisma.tradeSetup.update({
              where: { id: existingSetup.id },
              data: { categoryId: category?.id },
            });
          } else {
            await prisma.tradeSetup.create({
              data: {
                //@ts-ignore
                serverId: serverId,
                //@ts-ignore
                categoryId: category?.id,
                //@ts-ignore
                everyone: everyone.id,
              },
            });
          }

          await i.reply({
            content: "Trade setup configured successfully!",
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
        }
        break;
    }
  },
});
