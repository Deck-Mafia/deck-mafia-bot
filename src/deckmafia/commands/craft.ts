import {
	ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
	TextChannel,
} from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';

const CRAFT_COSTS: Record<number, number> = {
	3: 4,
	4: 10,
	5: 20,
	6: 30,
};

const CRAFTABLE_RARITIES = [3, 4, 5, 6];

const c = new SlashCommandBuilder();
c.setName('craft');
c.setDescription('Craft a card using Fragments');
c.setDefaultMemberPermissions(null);
c.addStringOption((o) =>
	o.setName('card').setDescription('Name of the card you want to craft').setRequired(true)
);

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;

		await i.deferReply();

		try {
			const targetUserId = i.user.id;
			const cardName = i.options.getString('card', true).toLowerCase();

			// 1. Look up the target card (must be public and craftable rarity)
			const targetCard = await prisma.card.findFirst({
				where: {
					name: cardName,
					isPublic: true,
					rarity: { in: CRAFTABLE_RARITIES },
				},
				select: { id: true, name: true, uri: true, rarity: true },
			});

			if (!targetCard) {
				return i.editReply({
					content: `No craftable public card found with the name \`${cardName}\`. The card must be rarity 3★, 4★, 5★, or 6★ and public.`,
				});
			}

			const rarity = targetCard.rarity!;
			const requiredFragments = CRAFT_COSTS[rarity];
			if (!requiredFragments) {
				return i.editReply({
					content: `Card \`${targetCard.name}\` has rarity ${rarity}★, which is not craftable. Craftable rarities: 3★, 4★, 5★, 6★.`,
				});
			}

			// 2. Atomically deduct fragments. Only succeeds if the user has enough.
			const result = await prisma.fragmentBalance.updateMany({
				where: {
					discordId: targetUserId,
					amount: { gte: requiredFragments },
				},
				data: {
					amount: { decrement: requiredFragments },
				},
			});

			if (result.count === 0) {
				// Either no FragmentBalance row exists, or not enough fragments
				const balance = await prisma.fragmentBalance.findUnique({
					where: { discordId: targetUserId },
					select: { amount: true },
				});
				const currentAmount = balance?.amount ?? 0;

				return i.editReply({
					content: `You don't have enough Fragments. You need **${requiredFragments}** Fragments to craft a ${rarity}★ card, but you only have **${currentAmount}**.`,
				});
			}

			// 3. Add the crafted card to the user's inventory
			await prisma.ownedCard.create({
				data: {
					card: { connect: { id: targetCard.id } },
					inventory: {
						connectOrCreate: {
							where: { discordId: targetUserId },
							create: { discordId: targetUserId },
						},
					},
				},
			});

			// 4. Post the card image to the channel
			const channel = i.channel;
			if (channel && channel.isTextBased() && !channel.isDMBased() && targetCard.uri) {
				await (channel as TextChannel).send({
					content: `<@${targetUserId}> crafted:\n${targetCard.uri}`,
				});
			}

			// 5. Build and send the summary embed
			const rarityLabels: Record<number, string> = {
				3: '3★',
				4: '4★',
				5: '5★',
				6: '6★',
			};

			const embed = new EmbedBuilder();
			embed.setTitle('Card Crafted');
			embed.setDescription(
				`<@${targetUserId}> crafted **${targetCard.name}** (${rarityLabels[rarity] ?? `${rarity}★`}) using ${requiredFragments} Fragments!`
			);
			embed.setColor(0x00ffcc);
			embed.setThumbnail(i.guild.iconURL());
			embed.addFields({
				name: 'Cost',
				value: `${requiredFragments} Fragments deducted`,
			});
			embed.setFooter({ text: 'Card has been added to your inventory.' });

			await i.editReply({ content: 'Crafting successful!', embeds: [embed] });
		} catch (err) {
			console.error('[CRAFT ERROR]', err);
			await i.editReply({
				content: 'An error occurred while crafting the card.',
			});
		}
	},
});