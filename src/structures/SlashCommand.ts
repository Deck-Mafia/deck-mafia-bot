import { REST, Routes, Client, Collection, CommandInteraction, SlashCommandBuilder } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { client } from '..';
import config from '../config';

const rest = new REST({ version: '10' }).setToken(config.discordBotToken);

export const commands: Collection<string, SlashCommand> = new Collection();

export interface SlashCommand {
	data: SlashCommandBuilder;
	execute: (i: CommandInteraction) => any | Promise<any>;
}

export async function newSlashCommand(cmd: SlashCommand) {
	try {
		commands.set(cmd.data.name, cmd);
		console.log(`Loaded [${cmd.data.name}]`);
		return cmd;
	} catch (err) {
		console.error(`Failed to load [${cmd.data.name}]`);
	}
}

export async function loadCommands() {
	const commandsPath = path.join(__dirname, '..', 'commands');
	const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.ts') || file.endsWith('.js'));
	for (const file of commandFiles) {
		try {
			const filePath = path.join(commandsPath, file);
			const slash = require(filePath).default as SlashCommand;
		} catch (err) {
			console.error(`Failed trying to load ${file}`);
			console.error(err);
		}
	}

	try {
		const list: any[] = [];
		commands.forEach((val) => {
			list.push(val.data.toJSON());
		});

		const data = (await rest.put(Routes.applicationCommands(config.discordBotClientId), { body: list })) as any;

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (err) {
		console.error(err);
	}
}
