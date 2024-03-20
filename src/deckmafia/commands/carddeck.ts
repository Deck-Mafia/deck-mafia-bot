import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";
import { Card } from '.prisma/client';
import { send } from 'process';

const cardsPerPage = 25;
const maxSelectedCards = 25;

const c = new SlashCommandBuilder();
c.setName("deck");
c.setDescription("View all the card deck commands!");
c.addSubcommand((x) =>
  x
    .setName("create")
    .setDescription("Create a new card deck")
    .addStringOption((x) =>
      x.setName("name").setDescription("Name of the deck").setRequired(true)
    )
);

c.addSubcommand((x) =>
  x
    .setName("share")
    .setDescription("Share one of your decks!")
    .addStringOption((x) =>
      x.setName("name").setDescription("Name of the deck").setRequired(true)
    )
);

c.addSubcommand((x) =>
  x
    .setName("submit")
    .setDescription("Submit your deck to use it in the game!")
    .addStringOption((x) =>
      x.setName("name").setDescription("Name of the deck").setRequired(true)
    )
);

c.addSubcommand((x) =>
  x
    .setName("delete")
    .setDescription("Delete one of your decks")
    .addStringOption((x) =>
      x
        .setName("name")
        .setDescription("Name of the deck to delete")
        .setRequired(true)
    )
);

c.addSubcommand((x) => x.setName("list").setDescription("List your decks"));

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    let selectedCards: string[] = [];

    switch (i.options.getSubcommand(true)) {
      case "create":
        try {
          const name = i.options.getString("name");

          const existingDeck = await prisma.cardDeck.findMany({
            //@ts-ignore
            where: { name: name, ownerId: i.user.id },
          });

          if (existingDeck.length > 0) {
            await i.reply({
              ephemeral: true,
              content:
                "You already have a deck with that name. Please choose a different name.",
            });
            return;
          }

          const allCards = await prisma.card.findMany({});

          if (allCards.length <= 0) {
            return i.reply({
              content: "There are no cards in the database.",
              ephemeral: true,
            });
          }

          const optionsPerPage = allCards
            .slice(0, cardsPerPage)
            .map((card, index) => ({
              label: card.name,
              value: `${card.name}`,
            }));

          const maxPages = Math.ceil(allCards.length / cardsPerPage);
          let page = 0;

          const initialReplyInteraction = await i.reply({
            content: "Initializing...",
          });

          const updateReply = async () => {
            const start = page * cardsPerPage;
            const end = start + cardsPerPage;
            const slicedCards = allCards
              .slice(start, end)
              .map((card, index) => ({
                label: card.name,
                value: `${card.name}`,
              }));

            const dynamicCardsPerPage = slicedCards.length;

            const selectMenuRow =
              new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
                new StringSelectMenuBuilder()
                  .setCustomId("add-to-deck")
                  .setOptions(slicedCards)
                  .setPlaceholder(
                    `Page ${
                      page + 1
                    }/${maxPages}: Select cards to add to the deck.`
                  )
                  .setMaxValues(Math.min(dynamicCardsPerPage, maxSelectedCards))
                  .setMinValues(0)
              );

            const paginationRow =
              new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                  .setCustomId("prev-page")
                  .setLabel("Previous Page")
                  .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                  .setCustomId("next-page")
                  .setLabel("Next Page")
                  .setStyle(ButtonStyle.Secondary)
              );

            const confirmButton =
              new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                  .setCustomId("confirm-deck")
                  .setLabel("Confirm Deck")
                  .setStyle(ButtonStyle.Success)
              );

            const reply = await initialReplyInteraction.edit({
              content: "",
              embeds: [
                new EmbedBuilder()
                  .setTitle("**Deck Builder**")
                  .setDescription(
                    "Use the selector to pick the cards you want to add to the deck!\n\nOnce you're done, click the Confirm Deck button."
                  )
                  .addFields({
                    //@ts-ignore
                    name: "Deck name",
                    value: name,
                  })
                  .addFields({
                    name: "Selected Cards",
                    value:
                      selectedCards.length > 0
                        ? selectedCards.join(", ")
                        : "No cards selected.",
                  }),
              ],
              components: [
                selectMenuRow.toJSON(),
                paginationRow.toJSON(),
                confirmButton.toJSON(),
              ],
            });

            return reply;
          };

          await updateReply();

          const collector = i.channel?.createMessageComponentCollector({
            filter: (interaction) =>
              interaction.isStringSelectMenu() &&
              interaction.customId === "add-to-deck" &&
              interaction.user.id === i.user.id,
            time: 60000,
          });

          collector?.on("collect", async (interaction) => {
            if (!interaction.isStringSelectMenu()) return;
            if (interaction.values) {
              if (interaction.values.length > maxSelectedCards) {
                await interaction.deferUpdate();
                await interaction.followUp({
                  content: `You can select up to ${maxSelectedCards} cards.`,
                  ephemeral: true,
                });
                return;
              }

              selectedCards = [...selectedCards, ...interaction.values];

              await updateReply();
              await interaction.deferUpdate();
            }
          });

          const paginationCollector =
            i.channel?.createMessageComponentCollector({
              filter: (interaction) =>
                interaction.isButton() &&
                (interaction.customId === "prev-page" ||
                  interaction.customId === "next-page") &&
                interaction.user.id === i.user.id,
              time: 60000,
            });

          paginationCollector?.on("collect", async (interaction) => {
            await interaction.deferUpdate();

            if (interaction.customId === "prev-page") {
              page = Math.max(0, page - 1);
            } else if (interaction.customId === "next-page") {
              page = Math.min(maxPages - 1, page + 1);
            }

            await updateReply();
          });

          const confirmCollector = i.channel?.createMessageComponentCollector({
            filter: (interaction) =>
              interaction.isButton() &&
              interaction.customId === "confirm-deck" &&
              interaction.user.id === i.user.id,
            time: 60000,
          });

          confirmCollector?.on("collect", async (i) => {
            if (selectedCards.length > 0) {
              const deckName = await prisma.inventory
                .findUnique({ where: { discordId: i.user.id } })
                .then((inventory) =>
                  prisma.cardDeck.create({
                    data: {
                      //@ts-ignore
                      name: name.toLowerCase(),
                      cards: { set: selectedCards },
                      ownerId: i.user.id,
                      //@ts-ignore
                      verified: false,
                    },
                  })
                );

              await initialReplyInteraction.edit({
                embeds: [
                  new EmbedBuilder()
                    .setTitle("**Deck Builder**")
                    .setDescription(
                      `Deck "${deckName?.name}" was successfully created with ${selectedCards.length} cards.`
                    )
                    .setColor("Green"),
                ],
                components: [],
              });
            } else {
              await initialReplyInteraction.edit({
                embeds: [
                  new EmbedBuilder()
                    .setTitle("**Deck Builder**")
                    .setDescription(
                      `No cards selected. Please use the command again!`
                    )
                    .setColor("Red"),
                ],
                components: [],
              });
            }
          });

          collector?.on("end", async () => {
            await initialReplyInteraction.edit({
              components: [],
            });
          });
        } catch (err) {
          console.error(err);
        }
        break;
      case "share":
        try {
          //@ts-ignore
          const name = i.options.getString("name").toLowerCase();

          const deck = await prisma.cardDeck.findFirst({
            //@ts-ignore
            where: { name: name, ownerId: i.user.id },
          });

          if (!deck) {
            await i.reply({
              ephemeral: true,
              content: "You don't own a deck with that name.",
            });
            return;
          }

          const cards = deck.cards;

          if (deck.ownerId !== i.user.id) {
            await i.reply({
              ephemeral: true,
              content: "You don't own this deck.",
            });
            return;
          }

          const cardInfo = await prisma.card.findMany({
            //@ts-ignore
            where: { name: { in: cards } },
            select: { name: true, uri: true },
          });

          console.log(cardInfo);

          const imageUrls = cardInfo.map((card) => `${card.uri}`);
          console.log(imageUrls);
          await i
            .reply({
              content: `\`Cards in Deck "${deck.name}"\``,
              files: imageUrls,
            })
            .catch((err) => {
              i.reply("One of the cards URL is invalid!");
            });
        } catch (err) {
          console.error(err);
        }
        break;

      case "submit":
        try {
          //@ts-ignore
          const name = i.options.getString("name").toLowerCase();

          const deck = await prisma.cardDeck.findFirst({
            //@ts-ignore
            where: { name: name, ownerId: i.user.id },
          });

          if (!deck) {
            await i.reply({
              ephemeral: true,
              content: "You don't own a deck with that name.",
            });
            return;
          }

          const cards = deck.cards;

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
                      uri: true,
                    },
                  },
                },
              },
            },
          });

          const ownsAllCards = cards.every((deckCard) => {
            return inventory?.ownedCards.some(
              //@ts-ignore
              (ownedCard) => ownedCard.card.name === deckCard
            );
          });

          if (ownsAllCards) {
            for (const deckCard of cards) {
              const matchingOwnedCard = inventory?.ownedCards.find(
                //@ts-ignore
                (ownedCard) => ownedCard.card.name === deckCard
              );

              if (matchingOwnedCard) {
                await i.channel?.send({
                  //@ts-ignore
                  content: `Card name: **${matchingOwnedCard.card.name}**`,
                  //@ts-ignore
                  files: [matchingOwnedCard.card.uri],
                });
              }
            }

            await prisma.cardDeck.update({
              where: { id: deck.id },
              //@ts-ignore
              data: { verified: true },
            });

            await i.reply({
              content: `Deck "${deck.name}" has been successfully submitted`,
              ephemeral: true,
            });
          } else {
            await i.reply({
              ephemeral: true,
              content:
                "You don't own all the cards in this deck, so you're not able to submit it.",
            });
          }
        } catch (err) {
          console.error(err);
        }
        break;

      case "delete":
        try {
          //@ts-ignore
          const nameToDelete = i.options.getString("name").toLowerCase();

          const deckToDelete = await prisma.cardDeck.findFirst({
            //@ts-ignore
            where: { name: nameToDelete, ownerId: i.user.id },
          });

          if (!deckToDelete) {
            await i.reply({
              ephemeral: true,
              content: `You don't own a deck with the name "${nameToDelete}".`,
            });
            return;
          }

          await prisma.cardDeck.delete({
            where: { id: deckToDelete.id },
          });

          await i.reply({
            content: `Deck "${deckToDelete.name}" has been successfully deleted.`,
            ephemeral: true,
          });
        } catch (err) {
          console.error(err);
        }
        break;
      case "list":
        try {
          const userDecks = await prisma.cardDeck.findMany({
            where: {
              //@ts-ignore
              ownerId: i.user.id,
            },
            select: {
              //@ts-ignore
              name: true,
            },
          });

          if (userDecks.length > 0) {
            const deckNames = userDecks
              .map((deck) => `> **${deck.name}**`)
              .join("\n");

            const embed = new EmbedBuilder()
              .setTitle("Your Decks")
              .setDescription(deckNames);

            await i.reply({ embeds: [embed], ephemeral: true });
          } else {
            await i.reply({
              content: "You don't have any decks.",
              ephemeral: true,
            });
          }
        } catch (err) {
          console.error(err);
        }
        break;
    }
  },
});
