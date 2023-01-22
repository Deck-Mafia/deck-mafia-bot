import { ActionRowBuilder, CategoryChannel, Channel, ChannelSelectMenuBuilder, ChannelType, Client, Colors, EmbedBuilder, Events, GatewayIntentBits, REST, TextChannel, UserSelectMenuBuilder } from 'discord.js';
import path from 'path';
import { prisma } from '..';
import config from '../config';
import { loadCommands, deiMilitesCommands } from '../structures/SlashCommand';

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const deiMilitesRest = new REST({ version: '10' }).setToken(config.deiMilitesBotToken);

client.on(Events.ClientReady, async (c) => {
	console.log(`Ready! Logged in as ${c.user.tag}`);
	const commandsPath = path.join(__dirname, '..', 'deimilites', 'commands');
	await loadCommands(client, commandsPath, deiMilitesRest, config.deiMilitesClientId, deiMilitesCommands);
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	const command = deiMilitesCommands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
	}
});

client.on(Events.InteractionCreate, async (i) => {
	if (!i.isButton()) return;
	if (i.customId === 'add-players') {
		const row = new ActionRowBuilder<UserSelectMenuBuilder>();
		row.addComponents(new UserSelectMenuBuilder().setCustomId('add-players').setMinValues(1).setMaxValues(10));
		await i.reply({ components: [row] });
	} else if (i.customId === 'manage-players') {
	}
});

client.on(Events.InteractionCreate, async (i) => {
	if (!i.isUserSelectMenu()) return;
	const values = i.values;
	const channel = i.channel as TextChannel;
	const category = channel.parent as CategoryChannel;

	switch (i.customId) {
		case 'manage-player':
			if (!i.guild) {
				i.reply({ content: 'An unexpected error has occurred fetching discord guild', ephemeral: true });
				return;
			}

			const userId = values[0];
			if (!userId) {
				i.reply({ content: 'Invalid input', ephemeral: true });
				return;
			}

			const user = i.guild.members.cache.get(userId);
			if (!user) {
				i.reply({ content: 'Invalid input', ephemeral: true });
				return;
			}

			const gameUser = await prisma.deiMilitesPlayer.findFirst({
				where: {
					game: {
						gameCategoryId: category.id,
					},
					discordId: user.id,
				},
			});

			console.log(gameUser);

			if (!gameUser) {
				i.reply({ content: 'User is not a part of the game.', ephemeral: true });
				return;
			}

			const embed = new EmbedBuilder();
			embed.setTitle(user.user.username);
			embed.setColor(Colors.Blurple);
			embed.addFields(
				{
					name: 'Health',
					value: gameUser.health.toString(),
					inline: true,
				},
				{
					name: 'Chel',
					value: 'N/A',
					inline: true,
				},
				{
					name: 'Elements',
					value: 'Mind - 4',
					inline: false,
				},
				{
					name: 'Spells',
					value: 'Blood Bond - 4 Native, 4 Mind ',
					inline: false,
				},
				{
					name: 'Creatures',
					value: 'None',
					inline: false,
				},
				{
					name: 'Items',
					value: 'None',
					inline: false,
				}
			);
			embed.setThumbnail(user.user.avatarURL());

			i.reply({ embeds: [embed] });
			break;
	}
});

export function start() {
	client.login(config.deiMilitesBotToken);
}
