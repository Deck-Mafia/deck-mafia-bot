import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";

const c = new SlashCommandBuilder();
c.setName("discard");
c.setDescription("Discard a card");
c.addStringOption((input) =>
  input.setName("name").setDescription("Name of the card").setRequired(true)
);
c.addUserOption((i) =>
  i
    .setName("user")
    .setDescription("User you want to discard a card for (admins only)")
    .setRequired(false)
);

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    const name = i.options.getString("name", true) as string;
    const user = i.options.getUser("user", false);

    try {
      let inventory;

      if (user) {
        //@ts-ignore
        const member = i.guild.members.cache.get(i.user.id);
        if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
          return i.reply({
            content:
              "You must be an administrator to discard a card in others' inventory!",
            ephemeral: true,
          });
        }

        inventory = await prisma.inventory.findUnique({
          where: {
            discordId: user.id,
          },
          include: {
            ownedCards: {
              where: {
                card: {
                  name: name.toLowerCase(),
                },
              },
            },
          },
        });
      } else {
        inventory = await prisma.inventory.findUnique({
          where: {
            discordId: i.user.id,
          },
          include: {
            ownedCards: {
              where: {
                card: {
                  name: name.toLowerCase(),
                },
              },
            },
          },
        });
      }

      if (!inventory || inventory.ownedCards.length === 0) {
        return i.reply({
          content: `No card with the name "${name}" found in the inventory.`,
          ephemeral: true,
        });
      }

      const cardToDiscard = inventory.ownedCards[0];

      await prisma.ownedCard.delete({
        where: {
          id: cardToDiscard.id,
        },
      });

      return i.reply({
        content: `Card "${name}" has been discarded from the inventory.`,
      });
    } catch (err) {
      console.error(err);
      return i.reply({
        ephemeral: true,
        content: "An error has occurred when discarding this card.",
      });
    }
  },
});
