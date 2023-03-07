import { Client, Events, GatewayIntentBits, REST } from 'discord.js';
import path, { join } from 'path';
import { prisma } from '..';
import config from '../config';
import { createSignupPost } from '../deckmafia/commands/signups';
import { loadCommands, deckMafiaCommands } from '../structures/SlashCommand';

export const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const deckMafiaRest = new REST({ version: '10' }).setToken(config.discordBotToken);

client.on(Events.ClientReady, async (c) => {
	console.log(`Ready! Logged in as ${c.user.tag}`);
	const commandsPath = path.join(__dirname, '..', 'deckmafia', 'commands');
	await loadCommands(client, commandsPath, deckMafiaRest, config.discordBotClientId, deckMafiaCommands);
});

client.on(Events.InteractionCreate, async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	const command = deckMafiaCommands.get(interaction.commandName);

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

	const tokens = i.customId.split('_');
	const customID = tokens.shift();
	let cache = '';
	if (tokens.length >= 1) cache = tokens.join('_');

	if (customID == 'player-join') {
		const joiningID = i.user.id;
		try {
			const signup = await prisma.signup.findFirst({ where: { id: cache } });
			if (!signup) {
				console.log('Signup no longer valid');

				await i.reply({ content: 'Signups is no longer valid', ephemeral: true });
				return;
			}

			const alreadyContains = signup.players.includes(joiningID);
			if (alreadyContains) {
				console.log('Already contains');
				await i.reply({ content: 'You are already signed up for this game.', ephemeral: true });
				return;
			}

			const updated = await prisma.signup.update({
				where: { id: signup.id },
				data: {
					players: {
						push: joiningID,
					},
				},
			});

			const { embed, row } = createSignupPost(updated, i.guild);
			i.message.edit({ embeds: [embed], components: [row] });
			await i.reply({ content: 'Successfully joined the signup', ephemeral: true });
		} catch (err) {
			await i.reply({ content: 'Unable to join signups, try again later', ephemeral: true });
		}
	} else if (customID == 'player-leave') {
		const leavingID = i.user.id;
		try {
			const signup = await prisma.signup.findFirst({ where: { id: cache } });
			if (!signup) {
				console.log('Signup no longer valid');

				await i.reply({ content: 'Signups is no longer valid', ephemeral: true });
				return;
			}

			const updated = await prisma.signup.update({
				where: { id: signup.id },
				data: {
					players: {
						set: signup.players.filter((id) => id !== leavingID),
					},
				},
			});

			const { embed, row } = createSignupPost(updated, i.guild);
			i.message.edit({ embeds: [embed], components: [row] });
			await i.reply({ content: 'Successfully left the signup, if you were in it.', ephemeral: true });
		} catch (err) {
			await i.reply({ content: 'Unable to join signups, try again later', ephemeral: true });
		}
	}
});

client.on(Events.InteractionCreate, async (i) => {
	if (!i.isStringSelectMenu()) return;
	if (i.customId === 'reveal-cards') {
		const values = i.values;
		let urls: string[] = [];
		for (let i = 0; i < values.length; i++) {
			const card = await prisma.ownedCard.findUnique({
				where: {
					id: values[i],
				},
				include: {
					card: true,
				},
			});

			if (card) urls.push(card.card.uri);
		}

		for (let index = 0; index < urls.length; index++) {
			if (i.channel) {
				i.channel.send({ content: `[${index + 1}/${urls.length}]<@${i.user.id}> has submitted\n${urls[index]}` });
			}
		}

		i.reply({ content: 'Done', ephemeral: true });
	}
});
export function start() {
	client.login(config.discordBotToken);
}
