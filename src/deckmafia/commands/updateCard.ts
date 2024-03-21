import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../..";
import { newSlashCommand } from "../../structures/SlashCommand";

const c = new SlashCommandBuilder();
c.setName("updatecard");
c.setDescription("Edit the link of any card");
c.addStringOption((o) =>
  o.setName("name").setDescription("Name of the card").setRequired(true)
);
c.addStringOption((i) =>
  i.setName("link").setDescription("New link").setRequired(true)
);

export default newSlashCommand({
  data: c,
  async execute(i: ChatInputCommandInteraction) {
    const cardName = i.options.getString("name", true) as string;
    const newLink = i.options.getString("link", true) as string;

    //@ts-ignore
    const member = i.guild.members.cache.get(i.user.id);
    if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return i.reply({
        content: "You must be an administrator to update the card.",
        ephemeral: true,
      });
    }

    if (!isValidUrl(newLink)) {
      return i.reply({
        content: "Please provide a valid URL for the new link.",
        ephemeral: true,
      });
    }

    try {
      const fetchedCard = await prisma.card.findFirst({
        where: { name: cardName.toLowerCase() },
      });

      if (!fetchedCard) {
        return i.reply({
          content: `No card was found with the name "${cardName}".`,
          ephemeral: true,
        });
      } else {
        await prisma.card.update({
          where: { id: fetchedCard.id },
          data: { uri: newLink },
        });

        const updatedCard = await prisma.card.findUnique({
          where: { id: fetchedCard.id },
        });

        return i.reply({
          //@ts-ignore
          content: `You successfully updated the link of the card "${cardName}".\nNew link: ${updatedCard.uri}`,
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error(err);
      return i.reply({
        content: "An unexpected error has occurred when updating the card.",
        ephemeral: true,
      });
    }
  },
});

function isValidUrl(url: string): boolean {
  const urlRegex = /^(ftp|http|https):\/\/[^ "]+$/;
  return urlRegex.test(url);
}
