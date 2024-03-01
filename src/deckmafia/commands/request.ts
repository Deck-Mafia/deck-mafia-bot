import { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ChatInputCommandInteraction, SlashCommandBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';

const cardsPerPage = 25;

const c = new SlashCommandBuilder();
c.setName('submit');
c.setDescription('Submit any amount of cards that you own.');

export default newSlashCommand({
    data: c,
    async execute(i: ChatInputCommandInteraction) {
        try {
            const ownedCards = await prisma.ownedCard.findMany({
                where: { inventory: { discordId: i.user.id } },
                include: { card: true },
            });

            let ownedCardList: { id: string, name: string }[] = [];
            ownedCards.forEach((v) => {
                if (v.card) ownedCardList.push({ id: v.id, name: v.card.name });
            });

            const totalPages = Math.ceil(ownedCardList.length / cardsPerPage);
            let page = 0;

            const initialReply = async () => {
                const start = page * cardsPerPage;
                const end = start + cardsPerPage;
                const slicedCards = ownedCardList.slice(start, end);

                const options = slicedCards.map((card) => ({
                    label: card.name,
                    value: String(card.id),
                }));

                const dynamicCardsPerPage = options.length;

                const selectMenuRow = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('reveal-cards')
                        .setOptions(options)
                        .setPlaceholder('Select all the cards you want to show.')
                        .setMaxValues(dynamicCardsPerPage)
                        .setMinValues(0)
                );

                const buttonRow = new ActionRowBuilder<ButtonBuilder>().setComponents(
                    new ButtonBuilder().setCustomId('submit-prev-page').setLabel('Previous Page').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                    new ButtonBuilder().setCustomId('submit-next-page').setLabel('Next Page').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
                );

                const content = `\`Page ${page + 1} of ${totalPages}\``;

                const reply = await i.reply({ content, components: [selectMenuRow.toJSON(), buttonRow.toJSON()], ephemeral: true });
                return reply;
            };

            const initialReplyInteraction = await initialReply();

            const collector = i.channel?.createMessageComponentCollector({
                filter: (interaction) => (interaction.isButton() && interaction.customId.startsWith('submit')) && interaction.user.id === i.user.id,
                time: 60000,
            });

            collector?.on('collect', async (interaction) => {
				if(interaction.customId === 'submit-prev-page' || interaction.customId === 'submit-next-page'){
                if (interaction.customId === 'submit-prev-page') {
                    await interaction.deferUpdate();
                    page = (page - 1 + totalPages) % totalPages;
                } else if (interaction.customId === 'submit-next-page') {
                    await interaction.deferUpdate();
                    page = (page + 1) % totalPages;
                }

                const start = page * cardsPerPage;
                const end = start + cardsPerPage;
                const slicedCards = ownedCardList.slice(start, end);

                const options = slicedCards.map((card) => ({
                    label: card.name,
                    value: String(card.id),
                }));

                const dynamicCardsPerPage = options.length;

                const updatedSelectMenuRow = new ActionRowBuilder<StringSelectMenuBuilder>().setComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('reveal-cards')
                        .setOptions(options)
                        .setPlaceholder('Select all the cards you want to show.')
                        .setMaxValues(dynamicCardsPerPage)
                        .setMinValues(0)
                );

                const updatedButtonRow = new ActionRowBuilder<ButtonBuilder>().setComponents(
                    new ButtonBuilder().setCustomId('submit-prev-page').setLabel('Previous Page').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                    new ButtonBuilder().setCustomId('submit-next-page').setLabel('Next Page').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages - 1)
                );

                const content = `\`Page ${page + 1} of ${totalPages}\``;

                await initialReplyInteraction.edit({ content, components: [updatedSelectMenuRow.toJSON(), updatedButtonRow.toJSON()] });
				}
            });

            collector?.on('end', async () => {
                await initialReplyInteraction.edit({ content: "`Buttons expired! Please use the command again!`", components: [] });
            });
        } catch (err) {
            await i.reply({
                ephemeral: true,
                content: 'An unexpected error has occurred while running this command. Please contact tech support.',
            });
            console.error(err);
        }
    },
});
