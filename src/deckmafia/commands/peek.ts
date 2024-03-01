import { ActionRowBuilder, ButtonBuilder, ChatInputCommandInteraction, SlashCommandBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';

const cardsPerPage = 25;

const c = new SlashCommandBuilder();
c.setName('peek');
c.setDescription('See what cards a player has in their inventory.');
c.addUserOption((i) => i.setName('user').setDescription('User you want to add a card for').setRequired(true));

export default newSlashCommand({
    data: c,
    async execute(i: ChatInputCommandInteraction) {
        const user = i.options.getUser('user', true);

        try {
            const inventory = await prisma.inventory.findUnique({
                where: {
                    discordId: user.id,
                },
                include: {
                    ownedCards: {
                        include: {
                            card: true,
                        },
                    },
                },
            });

            if (!inventory) return i.reply({ content: 'User does not have an inventory. To make one, use the `/give` command.' });

            let page = 0;

            const initialReply = async () => {
                const start = page * cardsPerPage;
                const end = start + cardsPerPage;
                const slicedCards = inventory.ownedCards.slice(start, end);

                let value = `\`\`\`diff\nINVENTORY FOR ${user.username.toUpperCase()}\n- ${inventory.ownedCards.length} CARDS TOTAL\n\n`;

                const cardCounts: { [cardName: string]: number } = {};

                slicedCards.forEach((ownedCard) => {
                    if (ownedCard.card) {
                        const cardName = ownedCard.card.name;
                        cardCounts[cardName] = (cardCounts[cardName] || 0) + 1;
                    }
                });

                Object.entries(cardCounts).forEach(([cardName, count]) => {
                    value += `+ ${cardName} x${count}\n`;
                });

                value += `\nPage ${page + 1} of ${Math.ceil(inventory.ownedCards.length / cardsPerPage)}\n\`\`\``;

                const buttonRow = new ActionRowBuilder<ButtonBuilder>().setComponents(
                    new ButtonBuilder().setCustomId('peek-prev-page').setLabel('Previous Page').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                    new ButtonBuilder().setCustomId('peek-next-page').setLabel('Next Page').setStyle(ButtonStyle.Secondary).setDisabled(page === Math.floor(inventory.ownedCards.length / cardsPerPage))
                );

                const reply = await i.reply({ content: value, components: [buttonRow.toJSON()], ephemeral: true });
                return reply;
            };

            const initialReplyInteraction = await initialReply();

            const collector = i.channel?.createMessageComponentCollector({
                filter: (interaction) => (interaction.isButton() && interaction.customId.startsWith('peek')) && interaction.user.id === i.user.id,
                time: 60000,
            });

            collector?.on('collect', async (interaction) => {
                if (interaction.customId === 'peek-prev-page' || interaction.customId === 'peek-next-page') {
                    if (interaction.customId === 'peek-prev-page') {
                        await interaction.deferUpdate();
                        page = Math.max(0, page - 1);
                    } else if (interaction.customId === 'peek-next-page') {
                        await interaction.deferUpdate();
                        page = Math.min(Math.floor(inventory.ownedCards.length / cardsPerPage), page + 1);
                    }

                    const start = page * cardsPerPage;
                    const end = start + cardsPerPage;
                    const slicedCards = inventory.ownedCards.slice(start, end);

                    let value = `\`\`\`diff\nINVENTORY FOR ${user.username.toUpperCase()}\n- ${inventory.ownedCards.length} CARDS TOTAL\n\n`;

                    const cardCounts: { [cardName: string]: number } = {};

                    slicedCards.forEach((ownedCard) => {
                        if (ownedCard.card) {
                            const cardName = ownedCard.card.name;
                            cardCounts[cardName] = (cardCounts[cardName] || 0) + 1;
                        }
                    });

                    Object.entries(cardCounts).forEach(([cardName, count]) => {
                        value += `+ ${cardName} x${count}\n`;
                    });

                    value += `\nPage ${page + 1} of ${Math.ceil(inventory.ownedCards.length / cardsPerPage)}\n\`\`\``;

                    const updatedButtonRow = new ActionRowBuilder<ButtonBuilder>().setComponents(
                        new ButtonBuilder().setCustomId('peek-prev-page').setLabel('Previous Page').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                        new ButtonBuilder().setCustomId('peek-next-page').setLabel('Next Page').setStyle(ButtonStyle.Secondary).setDisabled(page === Math.floor(inventory.ownedCards.length / cardsPerPage))
                    );

                    await initialReplyInteraction.edit({ content: value, components: [updatedButtonRow.toJSON()] });
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
