import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputStyle,
  TextInputBuilder,
} from "discord.js";
import path, { join } from "path";
import { database, prisma } from "..";
import config from "../config";
import {
  checkForRegularVoteCount,
  checkOnClose,
} from "../deckmafia/util/onTick";
import {
  calculateVoteCount,
  createVoteCountPost,
} from "../deckmafia/util/voteCount";
import { loadCommands, deckMafiaCommands } from "../structures/SlashCommand";

const {
  ViewChannel,
  SendMessages,
  ManageChannels,
  ReadMessageHistory,
  AttachFiles,
} = PermissionFlagsBits;

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const deckMafiaRest = new REST({ version: "10" }).setToken(
  config.discordBotToken
);

client.on(Events.ClientReady, async (c) => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
  const commandsPath = path.join(__dirname, "..", "deckmafia", "commands");
  await loadCommands(
    client,
    commandsPath,
    deckMafiaRest,
    config.discordBotClientId,
    deckMafiaCommands
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = deckMafiaCommands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "There was an error while executing this command!",
      ephemeral: true,
    });
  }
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton()) return;

  const tokens = i.customId.split("_");
  const customID = tokens.shift();
  let cache = "";
  if (tokens.length >= 1) cache = tokens.join("_");

  if (customID == "player-join") {
    const joiningID = i.user.id;
    try {
      const signup = await prisma.signup.findFirst({ where: { id: cache } });
      if (!signup) {
        await i.reply({
          content: "Signups is no longer valid",
          ephemeral: true,
        });
        return;
      }

      const alreadyContains = signup.players.includes(joiningID);
      if (alreadyContains) {
        await i.reply({
          content: "You are already signed up for this game.",
          ephemeral: true,
        });
        return;
      }

      const updated = await prisma.signup.update({
        where: { id: signup.id },
        data: {
          players: {
            push: joiningID,
          },
        },
      });

      await i.reply({
        content: "Successfully joined the signup",
        ephemeral: true,
      });
    } catch (err) {
      await i.reply({
        content: "Unable to join signups, try again later",
        ephemeral: true,
      });
    }
  } else if (customID == "player-leave") {
    const leavingID = i.user.id;
    try {
      const signup = await prisma.signup.findFirst({ where: { id: cache } });
      if (!signup) {
        await i.reply({
          content: "Signups is no longer valid",
          ephemeral: true,
        });
        return;
      }

      const updated = await prisma.signup.update({
        where: { id: signup.id },
        data: {
          players: {
            //@ts-ignore
            set: signup.players.filter((id) => id !== leavingID),
          },
        },
      });

      await i.reply({
        content: "Successfully left the signup, if you were in it.",
        ephemeral: true,
      });
    } catch (err) {
      await i.reply({
        content: "Unable to join signups, try again later",
        ephemeral: true,
      });
    }
    //@ts-ignore
  } else if (i.customId.startsWith("trade_request")) {
    await i.deferReply({ ephemeral: true });
    const tradeRequestId = i.customId.replace("trade_request_", "");

    const tradeRequest = await prisma.tradeRequest.findUnique({
      where: { id: tradeRequestId },
    });

    if (!tradeRequest) {
      i.editReply({
        //@ts-ignore
        ephemeral: true,
        content: "Trade request not found.",
      });
      return;
    }

    if (i.user.id == tradeRequest.userId) {
      i.editReply({
        //@ts-ignore
        ephemeral: true,
        content: "You cannot accept your own trade request",
      });
      return;
    }

    const tradeSetup = await prisma.tradeSetup.findFirst({
      where: { serverId: tradeRequest.serverId },
    });

    if (!tradeSetup) {
      i.reply({
        ephemeral: true,
        content:
          "Trade setup is not configured for this server. Contact an admin.",
      });
      return;
    }

    const existingRequest = await prisma.tradeChannel.findFirst(
      { where: { user1Id: i.user.id } } ||
        (await prisma.tradeChannel.findFirst({
          where: { user2Id: i.user.id },
        }))
    );

    if (existingRequest) {
      i.editReply({
        //@ts-ignore
        ephemeral: true,
        content: "You are already in a trade!",
      });
      return;
    }

    await i.message.delete();

    const guild = i.guild;
    const member = i.member;
    const category = tradeSetup.categoryId;

    await guild?.channels
      .create({
        name: `Trade_Channel_${tradeRequest.id}`,
        type: ChannelType.GuildText,
        parent: category,
        permissionOverwrites: [
          {
            id: tradeSetup.everyone,
            deny: [ViewChannel, SendMessages, ReadMessageHistory],
          },
          {
            id: i.user.id,
            allow: [ViewChannel, SendMessages, ReadMessageHistory],
          },
          {
            id: i.user.id,
            allow: [ViewChannel, SendMessages, ReadMessageHistory],
          },
          {
            id: tradeRequest.userId,
            allow: [ViewChannel, SendMessages, ReadMessageHistory],
          },
        ],
      })
      .then(async (channel) => {
        if (channel) {
          await prisma.tradeChannel.create({
            data: {
              serverId: tradeRequest.serverId,
              channelId: channel.id,
              user1Id: tradeRequest.userId,
              user2Id: i.user.id,
              user1card1Name: "",
              user1card2Name: "",
              user1card3Name: "",
              user2card1Name: "",
              user2card2Name: "",
              user2card3Name: "",
              user1Accepted: false,
              user2Accepted: false,
              createdAt: new Date(),
            },
          });
          const user = await client.users.fetch(tradeRequest.userId);

          const maxButtonLabelLength = 20;

          const truncatedIUsername =
            i.user.username.length > maxButtonLabelLength
              ? i.user.username.substring(0, maxButtonLabelLength - 3) + "..."
              : i.user.username;

          const truncatedUserUsername =
            user.username.length > maxButtonLabelLength
              ? user.username.substring(0, maxButtonLabelLength - 3) + "..."
              : user.username;

          await channel.send({
            content: `<@${tradeRequest.userId}> | ${i.user}`,
            embeds: [
              new EmbedBuilder()
                .setTitle("Trade Channel")
                .setDescription(`**Trade channel created:**`)
                .setColor(0x00ff00)
                .addFields(
                  {
                    name: "Instructions",
                    value:
                      "* Offer the cards you want to trade\n* Once both parties are satisfied, both users have to click their respective accept button\n* Once eveyone has accepted, the trade will be done!",
                  },
                  {
                    name: `${i.user.username}'s offer:`,
                    value: "`None`",
                    inline: true,
                  },
                  {
                    name: `${user.username}'s offer:`,
                    value: "`None`",
                  },
                  {
                    name: `${truncatedIUsername} accepted:`,
                    value: "🟥",
                    inline: false,
                  },
                  {
                    name: `${truncatedUserUsername} accepted:`,
                    value: "🟥",
                    inline: false,
                  }
                ),
            ],
            components: [
              new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                  .setCustomId(`trade_offer_${i.user.id}_${tradeRequest.id}`)
                  .setLabel(`${truncatedIUsername} Offer`)
                  .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                  .setCustomId(`trade_offer_${user.id}_${tradeRequest.id}`)
                  .setLabel(`${truncatedUserUsername} Offer`)
                  .setStyle(ButtonStyle.Success)
              ),
              new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                  .setCustomId(`trade_accept_${i.user.id}_${tradeRequest.id}`)
                  .setLabel(`${i.user.username} accept`)
                  .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                  .setCustomId(`trade_accept_${user.id}_${tradeRequest.id}_`)
                  .setLabel(`${user.username} accept`)
                  .setStyle(ButtonStyle.Danger)
              ),
              new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                  .setCustomId(`trade_cancel_${tradeRequest.id}`)
                  .setLabel("Cancel Trade")
                  .setStyle(ButtonStyle.Danger)
              ),
            ],
          });
        }

        await i.editReply({
          //@ts-ignore
          ephemeral: true,
          content: `Trade request accepted! The trade process will continue in the private channel: <#${channel.id}>`,
        });
      })
      .catch((err) => {
        console.log(err);
        i.editReply({
          //@ts-ignore
          ephemeral: true,
          content: `Something went wrong!`,
        });
      });

    //@ts-ignore
  } else if (i.customId.startsWith("trade_delete")) {
    const tradeRequestId = i.customId.replace("trade_delete_", "");

    const tradeRequest = await prisma.tradeRequest.findUnique({
      where: { id: tradeRequestId },
    });

    if (!tradeRequest) {
      i.reply({
        ephemeral: true,
        content: "Trade request not found.",
      });
      return;
    }

    if (i.user.id !== tradeRequest.userId) {
      i.reply({
        ephemeral: true,
        content: "You don't have permission to delete this trade request.",
      });
      return;
    }

    await prisma.tradeRequest.delete({
      where: { id: tradeRequestId },
    });

    const tradeRequestMessage = await i.channel?.messages.fetch(
      tradeRequest.messageId
    );
    if (tradeRequestMessage) {
      await tradeRequestMessage.delete();
    }

    await i.reply({
      ephemeral: true,
      content: "Trade request deleted successfully.",
    });
  } else if (i.customId.startsWith("trade_cancel")) {
    const tradeRequestId = i.customId.replace("trade_cancel_", "");

    const tradeRequest = await prisma.tradeRequest.findUnique({
      where: { id: tradeRequestId },
    });

    if (!tradeRequest) {
      i.reply({
        ephemeral: true,
        content: "Trade request not found.",
      });
      return;
    }

    const tradeChannels = await prisma.tradeChannel.findMany({
      where: {
        //@ts-ignore
        channelId: i.channel.id,
      },
    });

    if (tradeChannels.length > 0) {
      const tradeChannelToUpdate = tradeChannels[0];

      await i.message.edit({
        components: [],
      });

      await i.message.channel?.send({
        content: `**Trade canceled by <@${i.user.id}>. Channel wil be deleted in 5 seconds...**`,
      });

      setTimeout(async () => {
        await prisma.tradeRequest.delete({
          where: { id: tradeRequestId },
        });

        await prisma.tradeChannel.delete({
          where: { id: tradeChannelToUpdate.id },
        });

        await i.message.channel?.delete();
      }, 5000);
    } else {
      console.error(
        "TradeChannel records not found for channelId:",
        //@ts-ignore
        i.channel.id
      );
      i.reply({
        ephemeral: true,
        content: "Trade channel not found. Unable to cancel the trade.",
      });
    }
  } else if (i.customId.startsWith("trade_offer")) {
    const [action, action1, userId, tradeRequestId] = i.customId.split("_");

    const tradeRequest = await prisma.tradeRequest.findUnique({
      where: { id: tradeRequestId },
    });

    if (!tradeRequest) {
      i.reply({
        ephemeral: true,
        content: "Trade request not found.",
      });
      return;
    }

    if (userId !== i.user.id) {
      i.reply({
        ephemeral: true,
        content: "You can only use your own offer button!",
      });
      return;
    }

    const offerCardModal = new ModalBuilder()
      .setCustomId(`offerCardModal_${tradeRequest.id}`)
      .setTitle("Offer a Card");

    const card1Input = new TextInputBuilder()
      .setCustomId(`offerCardInput_${tradeRequest.id}_1`)
      .setLabel("Card 1 Name:")
      .setStyle(TextInputStyle.Short);

    const card2Input = new TextInputBuilder()
      .setCustomId(`offerCardInput_${tradeRequest.id}_2`)
      .setLabel("Card 2 Name (optional):")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const card3Input = new TextInputBuilder()
      .setCustomId(`offerCardInput_${tradeRequest.id}_3`)
      .setLabel("Card 3 Name (optional):")
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    const firstActionRow1 = new ActionRowBuilder().addComponents(card1Input);
    const firstActionRow2 = new ActionRowBuilder().addComponents(card2Input);
    const firstActionRow3 = new ActionRowBuilder().addComponents(card3Input);

    offerCardModal.addComponents(
      //@ts-ignore
      firstActionRow1,
      //@ts-ignore
      firstActionRow2,
      //@ts-ignore
      firstActionRow3
    );

    await i.showModal(offerCardModal).then(async () => {
      try {
        await i
          .awaitModalSubmit({
            filter: (modalInteraction) =>
              modalInteraction.customId ===
                `offerCardModal_${tradeRequest.id}` &&
              modalInteraction.user.id === i.user.id,
            time: 60000,
          })
          .then(async (m) => {
            try {
              const cardNames = [
                m.fields.getTextInputValue(
                  `offerCardInput_${tradeRequest.id}_1`
                ),
                m.fields.getTextInputValue(
                  `offerCardInput_${tradeRequest.id}_2`
                ),
                m.fields.getTextInputValue(
                  `offerCardInput_${tradeRequest.id}_3`
                ),
              ].filter(Boolean);

              const inventory = await prisma.inventory.findUnique({
                where: { discordId: m.user.id },
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

              for (const cardName of cardNames) {
                const requestedQuantity = cardNames.filter(
                  (name) => name === cardName
                ).length;

                const ownsRequestedCard =
                  inventory?.ownedCards.filter(
                    //@ts-ignore
                    (ownedCard) => ownedCard.card.name === cardName
                  ).length || 0;

                if (ownsRequestedCard < requestedQuantity) {
                  return m.reply({
                    ephemeral: true,
                    content: `You don't own enough of the card ${cardName} for the trade.`,
                  });
                }
              }

              const cardInfo1 = await prisma.card.findUnique({
                //@ts-ignore
                where: { name: cardNames[0] },
                select: { uri: true, isPublic: true },
              });

              let cardInfo2;
              let cardInfo3;

              if (cardNames[1] !== undefined) {
                cardInfo2 = await prisma.card.findUnique({
                  //@ts-ignore
                  where: { name: cardNames[1] },
                  select: { uri: true, isPublic: true },
                });
              }

              if (cardNames[2] !== undefined) {
                cardInfo3 = await prisma.card.findUnique({
                  //@ts-ignore
                  where: { name: cardNames[2] },
                  select: { uri: true, isPublic: true },
                });
              }

              if (
                cardInfo1?.isPublic == false ||
                (cardInfo2 && cardInfo2.isPublic == false) ||
                (cardInfo3 && cardInfo3.isPublic == false)
              ) {
                return m.reply({
                  ephemeral: true,
                  content:
                    "You can only trade public cards! If you want to trade secret cards, please contact staff!",
                });
              }

              const embed = i.message.embeds[0];
              if (embed) {
                const offerFieldIndex = embed.fields.findIndex(
                  (field) => field.name === `${i.user.username}'s offer:`
                );

                if (offerFieldIndex !== -1) {
                  embed.fields[offerFieldIndex].value = `\`${cardNames.join(
                    ", "
                  )}\``;

                  await i.message.edit({ embeds: [embed] });
                }
              }
              //@ts-ignore
              const channelId = i.channel.id;

              const tradeChannels = await prisma.tradeChannel.findMany({
                where: {
                  channelId: channelId,
                },
              });

              if (tradeChannels.length > 0) {
                const tradeChannel = tradeChannels[0];
                const userId = i.user.id;
                const isUser1 = userId === tradeChannel.user1Id;
                console.log(isUser1);

                if (isUser1) {
                  await prisma.tradeChannel.update({
                    where: { id: tradeChannel.id },
                    data: {
                      user1card1Name: cardNames[0] || "",
                      user1card2Name: cardNames[1] || "",
                      user1card3Name: cardNames[2] || "",
                    },
                  });
                } else {
                  await prisma.tradeChannel.update({
                    where: { id: tradeChannel.id },
                    data: {
                      user2card1Name: cardNames[0] || "",
                      user2card2Name: cardNames[1] || "",
                      user2card3Name: cardNames[2] || "",
                    },
                  });
                }

                return m.reply({
                  ephemeral: true,
                  content: `You have added the card(s) \`${cardNames.join(
                    ", "
                  )}\` to the trade.`,
                });
              }
            } catch (e) {
              console.log(e);
              await m.reply({
                ephemeral: true,
                content: "The trade request has timed out. Please try again.",
              });
            }
          });
      } catch (e) {}
    });
  } else if (i.customId.startsWith("trade_accept")) {
    const tokens = i.customId.split("_");
    const userId = tokens[2];
    const tradeRequestId = tokens[3];

    const tradeRequests = await prisma.tradeRequest.findMany({
      where: { id: tradeRequestId },
    });

    if (tradeRequests.length === 0) {
      i.reply({
        ephemeral: true,
        content: "Trade request not found.",
      });
      return;
    }

    const tradeRequest = tradeRequests[0];
    if (!tradeRequest) {
      i.reply({
        ephemeral: true,
        content: "Trade request not found.",
      });
      return;
    }

    if (i.user.id !== userId) {
      i.reply({
        ephemeral: true,
        content: "You don't have permission to accept others' trade requests.",
      });
      return;
    }

    const tradeChannels = await prisma.tradeChannel.findMany({
      //@ts-ignore
      where: { channelId: i.channel.id },
      take: 1,
    });

    if (tradeChannels.length > 0) {
      const updateData =
        userId === tradeRequest.userId
          ? { user1Accepted: true }
          : { user2Accepted: true };

      await prisma.tradeChannel.updateMany({
        //@ts-ignore
        where: { channelId: i.channel.id },
        data: updateData,
      });
    }

    const updatedTradeChannels = await prisma.tradeChannel.findMany({
      //@ts-ignore
      where: { channelId: i.channel.id },
      take: 1,
    });

    const updatedTradeChannel = updatedTradeChannels[0];

    if (
      updatedTradeChannel &&
      (updatedTradeChannel.user1Accepted || updatedTradeChannel.user2Accepted)
    ) {
      const user1 = await client.users.fetch(i.user.id);
      const user2 = await client.users.fetch(updatedTradeChannel.user2Id);
      const embed = i.message.embeds[0];

      if (embed) {
        const userAcceptedFieldIndex = embed.fields.findIndex(
          (field) =>
            field.name ===
            `${
              user1.id === updatedTradeChannel.user1Id
                ? user1.username
                : user2.username
            } accepted:`
        );

        if (userAcceptedFieldIndex !== -1) {
          embed.fields[userAcceptedFieldIndex].value = "🟩";

          await i.message.edit({ embeds: [embed] });
        }
      }

      await i.reply({
        ephemeral: true,
        content: `Trade request accepted!`,
      });

      if (
        updatedTradeChannel.user1Accepted &&
        updatedTradeChannel.user2Accepted
      ) {
        await i.message.edit({
          components: [],
        });

        const result = await giveCards(
          updatedTradeChannel.user1Id,
          updatedTradeChannel.user2Id,
          updatedTradeChannel.user1card1Name,
          updatedTradeChannel.user1card2Name,
          updatedTradeChannel.user1card3Name
        );

        const result2 = await giveCards(
          updatedTradeChannel.user2Id,
          updatedTradeChannel.user1Id,
          updatedTradeChannel.user2card1Name,
          updatedTradeChannel.user2card2Name,
          updatedTradeChannel.user2card3Name
        );

        const embed = new EmbedBuilder().setTitle(
          result === true ? "Trade Complete!" : "Trade Failed!"
        );

        embed.setDescription(
          result === true
            ? "🟩 Trade request accepted by both parties"
            : "🟥 Trade failed."
        );

        if (result !== true) {
          embed.addFields({
            name: "Error Message:",
            value: result,
          });
        } else if (result2 !== true) {
          embed.addFields({
            name: "Error Message:",
            value: result2,
          });
        } else if (result! == true && result2 !== true) {
          embed.addFields({
            name: "Error Message:",
            value: result + `\n` + result2,
          });
        }

        await i.message.edit({ embeds: [embed] });

        await i.message.channel?.send({
          content: `**Trade done! Channel will be deleted in 5 seconds...**`,
        });

        setTimeout(async () => {
          await prisma.tradeRequest.delete({
            where: { id: tradeRequestId },
          });

          await prisma.tradeChannel.delete({
            where: { id: updatedTradeChannel.id },
          });

          await i.message.channel?.delete();
        }, 5000);
      }
    }
  }
});

async function giveCards(
  user1Id: string,
  user2Id: string,
  card1Name: string,
  card2Name: string,
  card3Name: string
) {
  const giveCard = async (
    giverId: string,
    receiverId: string,
    cardName: string
  ) => {
    if (cardName === "") {
      return true;
    }

    const giverInventory = await prisma.inventory.findUnique({
      where: {
        discordId: giverId,
      },
      include: {
        ownedCards: {
          where: {
            card: {
              name: cardName,
            },
          },
        },
      },
    });

    if (!giverInventory || giverInventory.ownedCards.length === 0) {
      return `<@${giverId}> You do not have the specified card (${cardName}) in your inventory.`;
    }

    const card = await prisma.card.findUnique({
      where: {
        name: cardName,
      },
    });

    if (!card) {
      return `<@${giverId}> Card not found (${cardName}).`;
    }

    await prisma.ownedCard.create({
      data: {
        inventory: {
          connect: {
            discordId: receiverId,
          },
        },
        card: {
          connect: {
            id: card.id,
          },
        },
      },
    });

    const firstOwnedCard = await prisma.ownedCard.findFirst({
      where: {
        cardId: card.id,
        inventoryId: giverInventory.id,
      },
    });

    if (firstOwnedCard) {
      await prisma.ownedCard.delete({
        where: {
          id: firstOwnedCard.id,
        },
      });
    }

    return true;
  };

  const card1Result = await giveCard(user1Id, user2Id, card1Name);
  const card2Result = await giveCard(user1Id, user2Id, card2Name);
  const card3Result = await giveCard(user1Id, user2Id, card3Name);

  if (card1Result === true && card2Result === true && card3Result === true) {
    return true;
  } else {
    return [card1Result, card2Result, card3Result].filter(Boolean).join("\n");
  }
}

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isStringSelectMenu()) return;
  if (i.customId === "reveal-cards") {
    const values = i.values;

    let urls: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const card = await prisma.ownedCard.findUnique({
        where: {
          id: values[i],
        },
        include: {
          card: true,
        },
      });

      if (card && card.card) urls.push(card.card.uri);
    }

    for (let index = 0; index < urls.length; index++) {
      if (i.channel) {
        i.channel.send({
          content: `[${index + 1}/${urls.length}]<@${
            i.user.id
          }> has submitted\n${urls[index]}`,
        });
      }
    }

    i.reply({ content: "Done", ephemeral: true });
  }
});

client.on(Events.ShardDisconnect, (e, id) => {
  console.log(e.code, e.reason, id);
});

export async function start() {
  await client.login(config.discordBotToken);
  tick(client);
}

async function tick(client: Client) {
  const activeVoteCounts = await database.voteCount.findMany({
    where: { active: true },
  });
  await client.guilds.fetch();

  for (const voteCount of activeVoteCounts) {
    const { guildId, channelId, closeAt, id } = voteCount;
    const guild = client.guilds.cache.get(guildId);
    if (guild && closeAt) await checkOnClose({ guild, voteCount });
    if (guild && voteCount.lastPeriod)
      await checkForRegularVoteCount({ guild, voteCount });
  }

  setTimeout(() => {
    tick(client);
  }, 1000 * 10);
}
