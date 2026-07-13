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

// Pullable rarities (excludes -1 "unavailable from packs" and -99 "not processed")
const PULLABLE_RARITIES = [0, 3, 4, 5, 6];

const c = new SlashCommandBuilder();
c.setName('hiddenmenu');
c.setDescription('Draw a single card from the Hidden Menu (Admin only)');
c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;

		// Admin permission check
		//@ts-ignore
		const member = i.guild.members.cache.get(i.user.id);
		if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return i.reply({
				content: 'You must be an administrator to use this command.',
				flags: MessageFlags.Ephemeral,
			});
		}

		await i.deferReply();

		try {
			// Fetch all Hidden Menu cards (private cards with real rarities)
			const hiddenMenuCards = await prisma.card.findMany({
				where: {
					isPublic: false,
					rarity: { in: PULLABLE_RARITIES },
				},
				select: { id: true, name: true, uri: true, rarity: true },
			});

			if (hiddenMenuCards.length === 0) {
				return i.editReply({
					content:
						'**BUG: No Hidden Menu cards found.** Check the code — the pool is empty. No cards with `isPublic: false` and a valid rarity were found in the database.',
				});
			}

			// Equal odds — flat random pick from the entire pool
			const drawnCard = hiddenMenuCards[Math.floor(Math.random() * hiddenMenuCards.length)];

			// Post the card image to the channel
			const channel = i.channel;
			if (channel && channel.isTextBased() && !channel.isDMBased() && drawnCard.uri) {
				await (channel as TextChannel).send({
					content: `Hidden Menu draw:\n${drawnCard.uri}`,
				});
			}

			// Build and send the summary embed
			const rarityLabels: Record<number, string> = {
				0: '0★ (Item)',
				3: '3★',
				4: '4★',
				5: '5★',
				6: '6★',
			};

			const embed = new EmbedBuilder();
			embed.setTitle('Hidden Menu Draw');
			embed.setDescription(`Drew 1 card from the Hidden Menu!`);
			embed.setColor(0xf8f98e);
			embed.setThumbnail(i.guild.iconURL());

			embed.addFields({
				name: 'Card Drawn',
				value: `\`${drawnCard.name}\` — ${rarityLabels[drawnCard.rarity ?? -99] ?? `${drawnCard.rarity}★`}`,
			});

			embed.setFooter({ text: 'Use /give to add this card to a player\'s inventory.' });

			await i.editReply({ content: 'Hidden Menu draw complete!', embeds: [embed] });
		} catch (err) {
			console.error('[HIDDENMENU ERROR]', err);
			await i.editReply({
				content:
					'**BUG: An error occurred during the Hidden Menu draw.** Check the code and try again.',
			});
		}
	},
});
