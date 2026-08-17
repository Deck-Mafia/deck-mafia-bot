import {
	ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand } from '../../structures/SlashCommand';

// Maximum number of cards the public draw will return in one go (safety clamp).
const MAX_PUBLIC_DRAW = 50;

// Pullable rarities for the public catalog:
// Excludes 0★ items, uncommon 1★/2★ filler, -1 ("unavailable from packs") and -99 ("not processed").
const PULLABLE_RARITIES = [3, 4, 5, 6];

const rarityLabels: Record<number, string> = {
	0: '0★ (Item)',
	3: '3★',
	4: '4★',
	5: '5★',
	6: '6★',
};

function rarityLabel(rarity: number | null): string {
	return rarityLabels[rarity ?? -99] ?? `${rarity}★`;
}

// Pick `amount` unique random elements from an array (draw without replacement).
function sampleUnique<T>(items: T[], amount: number): T[] {
	const pool = [...items];
	// Fisher–Yates-style: swap-pick from the shrinking tail.
	for (let i = 0; i < amount && i < pool.length; i++) {
		const j = i + Math.floor(Math.random() * (pool.length - i));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, amount);
}

const c = new SlashCommandBuilder();
c.setName('draw');
c.setDescription(
	'Draw random card(s) from the public catalog or from a player\'s inventory (Admin only)'
);
c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

c.addSubcommand((sub) =>
	sub
		.setName('public')
		.setDescription('Draw a random card (or a hand of cards) from the public catalog.')
		.addIntegerOption((o) =>
			o
				.setName('count')
				.setDescription('Number of cards to draw (default 1). Cards are drawn without replacement.')
				.setRequired(false)
		)
);

c.addSubcommand((sub) =>
	sub
		.setName('inventory')
		.setDescription('Draw a single random card from a specific player\'s inventory.')
		.addUserOption((o) =>
			o
				.setName('user')
				.setDescription('The player whose inventory to draw from.')
				.setRequired(true)
		)
);

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
			const subcommand = i.options.getSubcommand(true);

			if (subcommand === 'public') {
				await handlePublicDraw(i);
			} else {
				await handleInventoryDraw(i);
			}
		} catch (err) {
			console.error('[DRAW ERROR]', err);
			await i.editReply({
				content: '**BUG: An error occurred during the draw.** Check the code and try again.',
			});
		}
	},
});

async function handlePublicDraw(i: ChatInputCommandInteraction) {
	const count = Math.max(1, i.options.getInteger('count') ?? 1);
	const cappedCount = Math.min(count, MAX_PUBLIC_DRAW);

	const publicCards = await prisma.card.findMany({
		where: {
			isPublic: true,
			rarity: { in: PULLABLE_RARITIES },
		},
		select: { id: true, name: true, uri: true, rarity: true },
	});

	if (publicCards.length === 0) {
		return i.editReply({
			content:
				'**BUG: No public cards found.** No cards with `isPublic: true` and a valid rarity were found in the database.',
		});
	}

	if (count > cappedCount) {
		await i.editReply({
			content: `Requested **${count}** cards, but the max per draw is **${MAX_PUBLIC_DRAW}**. Drawing **${cappedCount}** instead.`,
		});
	}

	const drawn = sampleUnique(publicCards, cappedCount);

	if (cappedCount === 1) {
		const card = drawn[0];
		const reply: string[] = [];
		reply.push(`Drew \`${card.name}\` — ${rarityLabel(card.rarity)}`);
		if (card.uri) reply.push(card.uri);
		return i.editReply({ content: reply.join('\n') });
	}

	// Post each card image to the channel for a multi-card hand.
	const channel = i.channel;
	if (channel && channel.isTextBased() && !channel.isDMBased()) {
		for (let index = 0; index < drawn.length; index++) {
			const card = drawn[index];
			if (card.uri) {
				// Send as a plain text channel message to avoid a giant single reply.
				await channel.send({
					content: `[${index + 1}/${drawn.length}] <@${i.user.id}> drew:\n${card.uri}`,
				});
			}
		}
	}

	const embed = new EmbedBuilder();
	embed.setTitle('Public Catalog Draw');
	embed.setDescription(`Drew **${drawn.length}** card${drawn.length === 1 ? '' : 's'} from the public catalog for <@${i.user.id}>!`);
	embed.setColor(0x57f287);
	embed.setThumbnail(i.guild?.iconURL() ?? null);

	const cardList = drawn
		.map((card, idx) => `${idx + 1}. \`${card.name}\` — ${rarityLabel(card.rarity)}`)
		.join('\n');
	embed.addFields({ name: 'Cards Drawn', value: cardList });

	embed.setFooter({ text: 'Cards may not all work — that is decided live.' });

	return i.editReply({ content: 'Draw complete!', embeds: [embed] });
}

async function handleInventoryDraw(i: ChatInputCommandInteraction) {
	const targetUser = i.options.getUser('user', true);

	const inventory = await prisma.inventory.findUnique({
		where: { discordId: targetUser.id },
		include: {
			ownedCards: {
				select: {
					id: true,
					card: { select: { name: true, uri: true, rarity: true } },
				},
			},
		},
	});

	if (!inventory || inventory.ownedCards.length === 0) {
		return i.editReply({
			content: `<@${targetUser.id}> has no cards in their inventory.`,
		});
	}

	const cardsWithData = inventory.ownedCards.filter((oc) => oc.card != null);

	if (cardsWithData.length === 0) {
		return i.editReply({
			content: `<@${targetUser.id}> has no cards in their inventory.`,
		});
	}

	const drawn = cardsWithData[Math.floor(Math.random() * cardsWithData.length)];
	const card = drawn.card!;

	const reply: string[] = [];
	reply.push(`Drew \`${card.name}\` — ${rarityLabel(card.rarity)} from <@${targetUser.id}>\'s inventory`);
	if (card.uri) reply.push(card.uri);

	return i.editReply({ content: reply.join('\n') });
}
