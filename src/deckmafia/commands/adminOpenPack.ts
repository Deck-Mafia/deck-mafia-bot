import {
	ChatInputCommandInteraction,
	EmbedBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextChannel,
} from 'discord.js';
import { MessageFlags } from 'discord.js';
import { newSlashCommand } from '../../structures/SlashCommand';
import { processOpenPack } from '../util/openPackLogic';

const c = new SlashCommandBuilder();
c.setName('adminopenpack');
c.setDescription('Open a Booster Pack for any user with extra options (Admin only)');
c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
c.addUserOption((o) =>
	o.setName('user').setDescription('The user whose booster pack will be opened').setRequired(true)
);
c.addBooleanOption((o) =>
	o
		.setName('extra')
		.setDescription('Pull 4 standard slots instead of 3 (5 cards total instead of 4)')
		.setRequired(false)
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

		const targetUser = i.options.getUser('user', true);
		const extraSlot = i.options.getBoolean('extra', false) ?? false;

		await i.deferReply();

		try {
			const targetUserId = targetUser.id;
			const channelName = (i.channel as TextChannel)?.name ?? 'unknown';

			const result = await processOpenPack(i, targetUserId, i.user.tag, extraSlot, channelName);

			if (!result) {
				return i.editReply({
					content: `<@${targetUserId}> does not have any Booster Packs in their inventory.`,
				});
			}

			const { drawnCards } = result;

			// Post results to the channel
			const channel = i.channel;
			if (channel && channel.isTextBased() && !channel.isDMBased()) {
				for (let index = 0; index < drawnCards.length; index++) {
					const card = drawnCards[index];
					if (card.uri) {
						await (channel as TextChannel).send({
							content: `[${index + 1}/${drawnCards.length}] <@${targetUserId}> pulled:\n${card.uri}`,
						});
					}
				}
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
			embed.setTitle('Booster Pack Opened');
			embed.setDescription(
				`<@${targetUserId}> opened a Booster Pack and pulled ${drawnCards.length} cards!`
			);
			embed.setColor(0xf8f98e);
			embed.setThumbnail(i.guild.iconURL());

			const cardList = drawnCards
				.map(
					(card, idx) =>
						`**${idx + 1}.** \`${card.name}\` — ${rarityLabels[card.rarity] ?? `${card.rarity}★`}`
				)
				.join('\n');

			embed.addFields({ name: 'Cards Pulled', value: cardList });

			await i.editReply({ content: 'Pack opened successfully!', embeds: [embed] });
		} catch (err) {
			console.error('[ADMINOPENPACK ERROR]', err);
			await i.editReply({
				content: 'An error occurred while opening the booster pack.',
			});
		}
	},
});