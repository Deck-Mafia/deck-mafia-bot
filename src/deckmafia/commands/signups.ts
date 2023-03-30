import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Colors, CommandInteraction, EmbedBuilder, Guild, SlashCommandBuilder, User } from 'discord.js';
import { prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import string from 'string-similarity';
import { Signup } from '@prisma/client';
import { sign } from 'crypto';

const amountOfCards = 19;

const c = new SlashCommandBuilder();
c.setName('signups');
c.setDescription('Create a new signups menu for players');

c.addStringOption((str) => str.setName('title').setDescription('Title shown on the signup').setRequired(false));
c.addIntegerOption((int) => int.setName('limit').setDescription('Set a player limit.').setRequired(false));
c.addIntegerOption((int) => int.setName('timer').setDescription('When does the signup close? (unix seconds)').setRequired(false));

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return i.reply({ content: '', ephemeral: true });
		const title = i.options.getString('title', false);
		const limit = i.options.getInteger('limit', false);
		const timer = i.options.getInteger('timer', false);

		try {
			const newSignup = await prisma.signup.create({
				data: {
					name: title ?? undefined,
					signupTimer: timer ?? undefined,
					limit: limit ?? undefined,
				},
			});

			const { embed, row } = createSignupPost(newSignup, i.guild);
			await i.reply({ embeds: [embed], components: [row] });
		} catch (err) {
			await i.reply({ content: 'An unexpected error has occurred', ephemeral: true });
		}
	},
});

interface SignupPost {
	row: ActionRowBuilder<ButtonBuilder>;
	embed: EmbedBuilder;
}
export function createSignupPost(signup: Signup, guild: Guild | null): SignupPost {
	const title = signup.name ?? 'Deck Mafia Signups';
	const timer = signup.signupTimer;
	const limit = signup.limit;
	const players = signup.players;
	let counter = `${players.length}${limit ? `/${limit}` : ''}`;

	let playerVal = '';
	for (let i = 0; i < players.length; i++) {
		let base = true;
		if (guild) {
			const user = guild.members.cache.get(players[i]);
			if (user) {
				base = false;
				playerVal += `> [${user.displayName}](discordapp.com/users/${user.user.id})\n`;
			}
		}

		if (base) playerVal += `> ${players[i]} <@${players[i]}>\n`;
	}

	if (playerVal == '') playerVal = '> Nobody';

	const embed = new EmbedBuilder();
	embed.setTitle(title);
	embed.setColor(Colors.Green);
	if (timer)
		embed.addFields({
			name: 'Times',
			value: `Signups Close at <t:${timer}:f>`,
			inline: false,
		});

	embed.addFields({
		name: `Players (${counter})`,
		value: playerVal.trim(),
		inline: false,
	});

	// embed.setFooter({
	// 	text: signup.id,
	// });

	const row = new ActionRowBuilder<ButtonBuilder>();
	row.addComponents(new ButtonBuilder().setCustomId(`player-join_${signup.id}`).setEmoji('✅').setStyle(ButtonStyle.Secondary));
	row.addComponents(new ButtonBuilder().setCustomId(`player-leave_${signup.id}`).setEmoji('❌').setStyle(ButtonStyle.Secondary));

	return { embed, row };
}
