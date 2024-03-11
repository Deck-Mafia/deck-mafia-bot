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
  x
    .setName("request")
    .setDescription("Request a trade for a specific card")
    .addStringOption((x) =>
      x
        .setName("firstcard")
        .setDescription("First card you want to trade")
        .setRequired(true)
    )
    .addStringOption((x) =>
      x
        .setName("secondcard")
        .setDescription("Second card you want to trade")
        .setRequired(false)
    )
    .addStringOption((x) =>
      x
        .setName("thirdcard")
        .setDescription("Third card you want to trade")
        .setRequired(false)
    )
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
          const card1Name = i.options.getString("firstcard");
          let card2Name = i.options.getString("secondcard") || null;
          let card3Name = i.options.getString("thirdcard") || null;
          const serverId = i.guild?.id;
          const userId = i.user.id;

          if (!card2Name) {
            card2Name = "";
          }

          if (!card3Name) {
            card3Name = "";
          }

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

          const requestedCards = [card1Name, card2Name, card3Name].filter(
            Boolean
          );

          for (const requestedCard of requestedCards) {
            const requestedQuantity = requestedCards.filter(
              (card) => card === requestedCard
            ).length;

            const ownsRequestedCard =
              inventory?.ownedCards.filter(
                //@ts-ignore
                (ownedCard) => ownedCard.card.name === requestedCard
              ).length || 0;

            if (ownsRequestedCard < requestedQuantity) {
              return i.reply({
                ephemeral: true,
                content: `You don't own enough of the card ${requestedCard} for the trade.`,
              });
            }
          }

          const existingRequest = await prisma.tradeRequest.findFirst({
            where: {
              userId: i.user.id,
              OR: [
                //@ts-ignore
                { card1Name: card1Name },
                //@ts-ignore
                { card2Name: card2Name },
                //@ts-ignore
                { card3Name: card3Name },
              ],
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

          const cardInfo1 = await prisma.card.findUnique({
            //@ts-ignore
            where: { name: card1Name },
            select: { uri: true, isPublic: true },
          });

          const cardInfo2 = await prisma.card.findUnique({
            //@ts-ignore
            where: { name: card2Name },
            select: { uri: true, isPublic: true },
          });

          const cardInfo3 = await prisma.card.findUnique({
            //@ts-ignore
            where: { name: card3Name },
            select: { uri: true, isPublic: true },
          });

          if (
            cardInfo1?.isPublic == false ||
            cardInfo2?.isPublic == false ||
            cardInfo3?.isPublic == false
          ) {
            return i.reply({
              ephemeral: true,
              content:
                "You can only trade public cards! If you want to trade secret cards, please contact staff!",
            });
          }
          await i.deferReply({ ephemeral: true });

          const tradeRequest = await prisma.tradeRequest.create({
            data: {
              userId: userId,
              //@ts-ignore
              card1Name: card1Name,
              //@ts-ignore
              card2Name: card2Name,
              //@ts-ignore
              card3Name: card3Name,
              //@ts-ignore
              serverId: serverId,
              //@ts-ignore
              channelId: i.channel?.id,
              messageId: "",
            },
          });

          const cardArray = [card1Name, card2Name, card3Name];
          const stackedCards = cardArray.reduce((acc, card) => {
            if (!card) return acc;
            const existingCard = acc.find((c) => c.name === card);
            if (existingCard) {
              existingCard.count++;
            } else {
              acc.push({ name: card, count: 1 });
            }
            return acc;
          }, [] as { name: string; count: number }[]);

          const description = stackedCards
            .map(
              (stack) =>
                `${stack.name} ${stack.count > 1 ? `(x${stack.count})` : ""}`
            )
            .join("\n");

          const message = await i.channel?.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("Trade Request")
                .setDescription(
                  `${i.user.username} is looking to trade the following cards!`
                )
                .addFields({ name: "Card(s)", value: description })
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
            files: [
              cardInfo1?.uri || "",
              cardInfo2?.uri || "",
              cardInfo3?.uri || "",
            ].filter(Boolean), // Exclude empty URIs
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
