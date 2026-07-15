import {
	ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextChannel,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';

const CRAFT_COSTS: Record<number, number> = {
	3: 4,
	4: 10,
	5: 20,
	6: 30,
};

const CRAFTABLE_RARITIES = [3, 4, 5, 6];

class InsufficientFragmentsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InsufficientFragmentsError';
	}
}

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

		// Channel gate: only allow in ticket-#### channels unless admin
		const channelName = (i.channel as TextChannel)?.name ?? '';
		//@ts-ignore
		const isAdmin = i.guild.members.cache.get(i.user.id)?.permissions.has(PermissionFlagsBits.Administrator);
		if (!/^ticket-\d+$/.test(channelName) && !isAdmin) {
			return i.reply({
				content: 'This command can only be used in a ticket channel (`ticket-####`).',
				flags: MessageFlags.Ephemeral,
			});
		}

		await i.deferReply();

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

		// 2+3. Atomically deduct fragments AND add the card in a transaction.
		// If either step fails, the entire operation is rolled back — no fragment loss.
		try {
			await prisma.$transaction(async (tx) => {
				const result = await tx.fragmentBalance.updateMany({
					where: {
						discordId: targetUserId,
						amount: { gte: requiredFragments },
					},
					data: {
						amount: { decrement: requiredFragments },
					},
				});

				if (result.count === 0) {
					// Not enough fragments — throw to abort the transaction
					const balance = await tx.fragmentBalance.findUnique({
						where: { discordId: targetUserId },
						select: { amount: true },
					});
					const currentAmount = balance?.amount ?? 0;
					throw new InsufficientFragmentsError(
						`You don't have enough Fragments. You need **${requiredFragments}** Fragments to craft a ${rarity}★ card, but you only have **${currentAmount}**.`
					);
				}

				await tx.ownedCard.create({
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
			});
		} catch (err) {
			if (err instanceof InsufficientFragmentsError) {
				return i.editReply({ content: err.message });
			}
			console.error('[CRAFT ERROR]', err);
			return i.editReply({
				content: 'An error occurred while crafting the card. Your fragments have NOT been deducted. Please try again later.',
			});
		}

		// 4. Post the card image to the channel (best-effort, outside transaction so it can't roll back)
		const channel = i.channel;
		if (channel && channel.isTextBased() && !channel.isDMBased() && targetCard.uri) {
			try {
				await (channel as TextChannel).send({
					content: `<@${targetUserId}> crafted:\n${targetCard.uri}`,
				});
			} catch (err) {
				console.error('[CRAFT IMAGE POST ERROR]', err);
				// Non-fatal: card is already in inventory, embed will still be shown
			}
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
	},
});