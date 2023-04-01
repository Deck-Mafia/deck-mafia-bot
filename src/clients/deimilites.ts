import { ActionRowBuilder, Client, Events, GatewayIntentBits, REST, TextChannel, UserSelectMenuBuilder } from 'discord.js';
import path from 'path';
import { prisma } from '..';
import config from '../config';
import { createSpell, createSpellPost } from '../deimilites/utils/spells';
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
	if (!i.isModalSubmit()) return;
	const channel = i.channel;
	if (!channel) return;
	if (!channel || !channel.isTextBased()) return;
	const category = (channel as TextChannel).parentId;
	if (!category) return;
	const split = i.customId.split('_');

	if (split[0] == 'new-spell') {
		try {
			const name = i.fields.getTextInputValue('spell-name');
			const description = i.fields.getTextInputValue('spell-effect');
			const cost = i.fields.getTextInputValue('spell-cost');
			const sideEffects = i.fields.getTextInputValue('spell-side-effect');
			const hidden = i.fields.getTextInputValue('spell-hidden');

			const { spell, status } = await createSpell(category, { name, description, cost, sideEffects, hidden });
			if (!spell) {
				console.log(status);
				return;
			}

			const { embed } = createSpellPost(spell);
			await i.reply({ embeds: [embed] });
		} catch (err) {
			console.log(err);
		}
	} else if (split[0] == 'edit-spell') {
		const name = i.fields.getTextInputValue('spell-name');
		const description = i.fields.getTextInputValue('spell-effect');
		const cost = i.fields.getTextInputValue('spell-cost');
		const sideEffects = i.fields.getTextInputValue('spell-side-effect');
		const hidden = i.fields.getTextInputValue('spell-hidden');

		const spellID = split[1];

		const updated = await prisma.spell.update({
			where: {
				id: spellID,
			},
			data: {
				name,
				description,
				cost,
				sideEffects,
				hidden,
			},
		});

		const { embed } = createSpellPost(updated);
		await i.reply({ embeds: [embed] });
	} else if (split[0] === 'new-item') {
		const name = i.fields.getTextInputValue('item-name');
		const description = i.fields.getTextInputValue('item-effect');
		const cost = i.fields.getTextInputValue('item-cost');
		const hidden = i.fields.getTextInputValue('item-hidden');
	}

	/* 
		Errors here have no response to not lose the data.
		Soon. Make an error embed, and return that instead with all the data.
	*/
});

export function start() {
	client.login(config.deiMilitesBotToken);
}
