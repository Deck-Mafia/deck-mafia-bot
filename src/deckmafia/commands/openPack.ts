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
c.setName('openpack');
c.setDescription('Open one of your Booster Packs');
c.setDefaultMemberPermissions(null);

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

		try {
			const targetUserId = i.user.id;
			const channelName = (i.channel as TextChannel)?.name ?? 'unknown';

			const result = await processOpenPack(i, targetUserId, i.user.tag, false, channelName);

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
			embed.setDescription(`<@${targetUserId}> opened a Booster Pack and pulled ${drawnCards.length} cards!`);
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
			console.error('[OPENPACK ERROR]', err);
			await i.editReply({
				content: 'An error occurred while opening the booster pack.',
			});
		}
	},
});