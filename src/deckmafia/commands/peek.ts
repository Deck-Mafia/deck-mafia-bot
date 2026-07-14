import {
  ActionRowBuilder,
  ButtonBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from "discord.js";
import { MessageFlags } from "discord.js";
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

function buildPageContent(
  username: string,
  cardCounts: Record<string, number>,
  totalCards: number,
  page: number
): string {
  const start = page * cardsPerPage;
  const slicedCards = Object.entries(cardCounts).slice(start, start + cardsPerPage);

  let value = `\`\`\`diff\nINVENTORY FOR ${username.toUpperCase()}\n- ${totalCards} CARDS TOTAL\n\n`;

  slicedCards.forEach(([cardName, count]) => {
    value += `+ ${cardName} x${count}\n`;
  });

  value += `\nPage ${page + 1} of ${Math.ceil(
    Object.keys(cardCounts).length / cardsPerPage
  )}\n\`\`\``;

  return value;
}

function buildComponents(cardCounts: Record<string, number>, page: number) {
  const hasMultiplePages =
    Math.ceil(Object.keys(cardCounts).length / cardsPerPage) > 1;

  return hasMultiplePages
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
                page === Math.floor(Object.keys(cardCounts).length / cardsPerPage)
              )
          )
          .toJSON(),
      ]
    : [];
}

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
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        const [inventory, fragmentBalance] = await Promise.all([
          prisma.inventory.findUnique({
            where: { discordId: user.id },
            include: {
              ownedCards: {
                select: {
                  cardId: true,
                  card: { select: { name: true } },
                },
              },
            },
          }),
          prisma.fragmentBalance.findUnique({
            where: { discordId: user.id },
            select: { amount: true },
          }),
        ]);

        if (!inventory)
          return i.reply({
            content: "User does not have an inventory. To make one, use the `/give` command.",
          });

        const fragmentAmount = fragmentBalance?.amount ?? 0;

        const cardCounts: Record<string, number> = inventory.ownedCards.reduce(
          (acc: Record<string, number>, ownedCard) => {
            //@ts-ignore
            const cardName: string = ownedCard.card.name;
            acc[cardName] = (acc[cardName] || 0) + 1;
            return acc;
          },
          {}
        );

        if (fragmentAmount > 0) {
          cardCounts["Fragment"] = fragmentAmount;
        }

        const totalCards = inventory.ownedCards.length + (fragmentAmount > 0 ? 1 : 0);

        let page = 0;

        const initialReplyInteraction = await i.reply({
          content: buildPageContent(user.username, cardCounts, totalCards, page),
          components: buildComponents(cardCounts, page),
        });

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
            await interaction.deferUpdate();

            if (interaction.customId === "peek-prev-page") {
              page = Math.max(0, page - 1);
            } else {
              page = Math.min(
                Math.floor(Object.keys(cardCounts).length / cardsPerPage),
                page + 1
              );
            }

            await initialReplyInteraction.edit({
              content: buildPageContent(user.username, cardCounts, totalCards, page),
              components: buildComponents(cardCounts, page),
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
          flags: MessageFlags.Ephemeral,
          content:
            "An unexpected error has occurred while running this command. Please contact tech support. (Error Code: 2)",
        });
        console.error(err);
      }
    } else {
      try {
        const [inventory, fragmentBalance] = await Promise.all([
          prisma.inventory.findUnique({
            where: { discordId: i.user.id },
            include: {
              ownedCards: {
                select: {
                  cardId: true,
                  card: { select: { name: true } },
                },
              },
            },
          }),
          prisma.fragmentBalance.findUnique({
            where: { discordId: i.user.id },
            select: { amount: true },
          }),
        ]);

        if (!inventory)
          return i.reply({
            content: "User does not have an inventory. To make one, use the `/give` command.",
          });

        const fragmentAmount = fragmentBalance?.amount ?? 0;

        const cardCounts: Record<string, number> = inventory.ownedCards.reduce(
          (acc: Record<string, number>, ownedCard) => {
            //@ts-ignore
            const cardName: string = ownedCard.card.name;
            acc[cardName] = (acc[cardName] || 0) + 1;
            return acc;
          },
          {}
        );

        if (fragmentAmount > 0) {
          cardCounts["Fragment"] = fragmentAmount;
        }

        const totalCards = inventory.ownedCards.length + (fragmentAmount > 0 ? 1 : 0);

        let page = 0;

        const initialReplyInteraction = await i.reply({
          content: buildPageContent(i.user.username, cardCounts, totalCards, page),
          components: buildComponents(cardCounts, page),
        });

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
            await interaction.deferUpdate();

            if (interaction.customId === "peek-prev-page") {
              page = Math.max(0, page - 1);
            } else {
              page = Math.min(
                Math.floor(Object.keys(cardCounts).length / cardsPerPage),
                page + 1
              );
            }

            await initialReplyInteraction.edit({
              content: buildPageContent(i.user.username, cardCounts, totalCards, page),
              components: buildComponents(cardCounts, page),
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
          flags: MessageFlags.Ephemeral,
          content:
            "An unexpected error has occurred while running this command. Please contact tech support. (Error Code: 3)",
        });
        console.error(err);
      }
    }
  },
});