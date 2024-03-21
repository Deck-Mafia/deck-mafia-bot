import {
  ActionRowBuilder,
  ButtonBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";

const cardsPerPage = 25;

const c = new SlashCommandBuilder();
c.setName("peek");
c.setDescription("See what cards a player has in their inventory.");
c.addUserOption((i) =>
  i
    .setName("user")
    .setDescription("Check this user's inventory (admin only).")
    .setRequired(false)
);

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    const user = i.options.getUser("user");

    if (user) {
      //@ts-ignore
      const member = i.guild.members.cache.get(i.user.id);
      if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
        return i.reply({
          content: "You must be an administrator to view others inventory.",
          ephemeral: true,
        });
      }

      try {
        const inventory = await prisma.inventory.findUnique({
          where: {
            discordId: user.id,
          },
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

        if (!inventory)
          return i.reply({
            content:
              "User does not have an inventory. To make one, use the `/give` command.",
          });

        const cardCounts = inventory.ownedCards.reduce((acc, ownedCard) => {
          //@ts-ignore
          const cardName = ownedCard.card.name;
          //@ts-ignore
          acc[cardName] = (acc[cardName] || 0) + 1;
          return acc;
        }, {});

        let page = 0;

        const initialReply = async () => {
          const start = page * cardsPerPage;
          const end = start + cardsPerPage;
          const slicedCards = Object.entries(cardCounts).slice(start, end);

          let value = `\`\`\`diff\nINVENTORY FOR ${user.username.toUpperCase()}\n- ${
            inventory.ownedCards.length
          } CARDS TOTAL\n\n`;

          slicedCards.forEach(([cardName, count]) => {
            value += `+ ${cardName} x${count}\n`;
          });

          value += `\nPage ${page + 1} of ${Math.ceil(
            Object.keys(cardCounts).length / cardsPerPage
          )}\n\`\`\``;

          const hasMultiplePages =
            Math.ceil(Object.keys(cardCounts).length / cardsPerPage) > 1;

          const components = hasMultiplePages
            ? [
                new ActionRowBuilder<ButtonBuilder>()
                  .setComponents(
                    new ButtonBuilder()
                      .setCustomId("peek-prev-page")
                      .setLabel("Previous Page")
                      .setStyle(ButtonStyle.Secondary)
                      .setDisabled(page === 0),
                    new ButtonBuilder()
                      .setCustomId("peek-next-page")
                      .setLabel("Next Page")
                      .setStyle(ButtonStyle.Secondary)
                      .setDisabled(
                        page ===
                          Math.floor(
                            Object.keys(cardCounts).length / cardsPerPage
                          )
                      )
                  )
                  .toJSON(),
              ]
            : [];

          const reply = await i.reply({
            content: value,
            components,
          });
          return reply;
        };

        const initialReplyInteraction = await initialReply();

        const collector = i.channel?.createMessageComponentCollector({
          filter: (interaction) =>
            interaction.isButton() &&
            interaction.customId.startsWith("peek") &&
            interaction.user.id === i.user.id,
          time: 60000,
        });

        collector?.on("collect", async (interaction) => {
          if (
            interaction.customId === "peek-prev-page" ||
            interaction.customId === "peek-next-page"
          ) {
            if (interaction.customId === "peek-prev-page") {
              await interaction.deferUpdate();
              page = Math.max(0, page - 1);
            } else if (interaction.customId === "peek-next-page") {
              await interaction.deferUpdate();
              page = Math.min(
                Math.floor(Object.keys(cardCounts).length / cardsPerPage),
                page + 1
              );
            }

            const start = page * cardsPerPage;
            const end = start + cardsPerPage;
            const slicedCards = Object.entries(cardCounts).slice(start, end);

            let value = `\`\`\`diff\nINVENTORY FOR ${user.username.toUpperCase()}\n- ${
              inventory.ownedCards.length
            } CARDS TOTAL\n\n`;

            slicedCards.forEach(([cardName, count]) => {
              value += `+ ${cardName} x${count}\n`;
            });

            value += `\nPage ${page + 1} of ${Math.ceil(
              Object.keys(cardCounts).length / cardsPerPage
            )}\n\`\`\``;

            const hasMultiplePages =
              Math.ceil(Object.keys(cardCounts).length / cardsPerPage) > 1;

            const updatedComponents = hasMultiplePages
              ? [
                  new ActionRowBuilder<ButtonBuilder>()
                    .setComponents(
                      new ButtonBuilder()
                        .setCustomId("peek-prev-page")
                        .setLabel("Previous Page")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === 0),
                      new ButtonBuilder()
                        .setCustomId("peek-next-page")
                        .setLabel("Next Page")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(
                          page ===
                            Math.floor(
                              Object.keys(cardCounts).length / cardsPerPage
                            )
                        )
                    )
                    .toJSON(),
                ]
              : [];

            await initialReplyInteraction.edit({
              content: value,
              components: updatedComponents,
            });
          }
        });

        collector?.on("end", async () => {
          await initialReplyInteraction.edit({
            content: "`Buttons expired! Please use the command again!`",
            components: [],
          });
        });
      } catch (err) {
        await i.reply({
          ephemeral: true,
          content:
            "An unexpected error has occurred while running this command. Please contact tech support.",
        });
        console.error(err);
      }
    } else {
      try {
        const inventory = await prisma.inventory.findUnique({
          where: {
            discordId: i.user.id,
          },
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

        if (!inventory)
          return i.reply({
            content:
              "User does not have an inventory. To make one, use the `/give` command.",
          });

        const cardCounts = inventory.ownedCards.reduce((acc, ownedCard) => {
          //@ts-ignore
          const cardName = ownedCard.card.name;
          //@ts-ignore
          acc[cardName] = (acc[cardName] || 0) + 1;
          return acc;
        }, {});

        let page = 0;

        const initialReply = async () => {
          const start = page * cardsPerPage;
          const end = start + cardsPerPage;
          const slicedCards = Object.entries(cardCounts).slice(start, end);

          let value = `\`\`\`diff\nINVENTORY FOR ${i.user.username.toUpperCase()}\n- ${
            inventory.ownedCards.length
          } CARDS TOTAL\n\n`;

          slicedCards.forEach(([cardName, count]) => {
            value += `+ ${cardName} x${count}\n`;
          });

          value += `\nPage ${page + 1} of ${Math.ceil(
            Object.keys(cardCounts).length / cardsPerPage
          )}\n\`\`\``;

          const hasMultiplePages =
            Math.ceil(Object.keys(cardCounts).length / cardsPerPage) > 1;

          const components = hasMultiplePages
            ? [
                new ActionRowBuilder<ButtonBuilder>()
                  .setComponents(
                    new ButtonBuilder()
                      .setCustomId("peek-prev-page")
                      .setLabel("Previous Page")
                      .setStyle(ButtonStyle.Secondary)
                      .setDisabled(page === 0),
                    new ButtonBuilder()
                      .setCustomId("peek-next-page")
                      .setLabel("Next Page")
                      .setStyle(ButtonStyle.Secondary)
                      .setDisabled(
                        page ===
                          Math.floor(
                            Object.keys(cardCounts).length / cardsPerPage
                          )
                      )
                  )
                  .toJSON(),
              ]
            : [];

          const reply = await i.reply({
            content: value,
            components,
          });
          return reply;
        };

        const initialReplyInteraction = await initialReply();

        const collector = i.channel?.createMessageComponentCollector({
          filter: (interaction) =>
            interaction.isButton() &&
            interaction.customId.startsWith("peek") &&
            interaction.user.id === i.user.id,
          time: 60000,
        });

        collector?.on("collect", async (interaction) => {
          if (
            interaction.customId === "peek-prev-page" ||
            interaction.customId === "peek-next-page"
          ) {
            if (interaction.customId === "peek-prev-page") {
              await interaction.deferUpdate();
              page = Math.max(0, page - 1);
            } else if (interaction.customId === "peek-next-page") {
              await interaction.deferUpdate();
              page = Math.min(
                Math.floor(Object.keys(cardCounts).length / cardsPerPage),
                page + 1
              );
            }

            const start = page * cardsPerPage;
            const end = start + cardsPerPage;
            const slicedCards = Object.entries(cardCounts).slice(start, end);

            let value = `\`\`\`diff\nINVENTORY FOR ${i.user.username.toUpperCase()}\n- ${
              inventory.ownedCards.length
            } CARDS TOTAL\n\n`;

            slicedCards.forEach(([cardName, count]) => {
              value += `+ ${cardName} x${count}\n`;
            });

            value += `\nPage ${page + 1} of ${Math.ceil(
              Object.keys(cardCounts).length / cardsPerPage
            )}\n\`\`\``;

            const hasMultiplePages =
              Math.ceil(Object.keys(cardCounts).length / cardsPerPage) > 1;

            const updatedComponents = hasMultiplePages
              ? [
                  new ActionRowBuilder<ButtonBuilder>()
                    .setComponents(
                      new ButtonBuilder()
                        .setCustomId("peek-prev-page")
                        .setLabel("Previous Page")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === 0),
                      new ButtonBuilder()
                        .setCustomId("peek-next-page")
                        .setLabel("Next Page")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(
                          page ===
                            Math.floor(
                              Object.keys(cardCounts).length / cardsPerPage
                            )
                        )
                    )
                    .toJSON(),
                ]
              : [];

            await initialReplyInteraction.edit({
              content: value,
              components: updatedComponents,
            });
          }
        });

        collector?.on("end", async () => {
          await initialReplyInteraction.edit({
            content: "`Buttons expired! Please use the command again!`",
            components: [],
          });
        });
      } catch (err) {
        await i.reply({
          ephemeral: true,
          content:
            "An unexpected error has occurred while running this command. Please contact tech support.",
        });
        console.error(err);
      }
    }
  },
});
