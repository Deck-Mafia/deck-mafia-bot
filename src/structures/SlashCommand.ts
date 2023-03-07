import { REST, Routes, Client, Collection, CommandInteraction, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import path from 'path';
import fs from 'fs';
import config from '../config';

export const deckMafiaCommands: Collection<string, SlashCommand> = new Collection();
export const deiMilitesCommands: Collection<string, SlashCommand> = new Collection();

export interface SlashCommand {
	data: SlashCommandBuilder;
	execute: (i: ChatInputCommandInteraction) => any | Promise<any>;
}

export async function newSlashCommand(cmd: SlashCommand) {
	try {
		deckMafiaCommands.set(cmd.data.name, cmd);
		console.log(`Loaded [${cmd.data.name}]`);
		return cmd;
	} catch (err) {
		console.error(`Failed to load [${cmd.data.name}]`);
	}
}

export async function newDeiMilitesCommand(cmd: SlashCommand) {
	try {
		deiMilitesCommands.set(cmd.data.name, cmd);
		console.log(`Loaded [${cmd.data.name}]`);
		return cmd;
	} catch (err) {
		console.error(`Failed to load [${cmd.data.name}]`);
	}
}

export async function loadCommands(client: Client, commandsPath: string, rest: REST, clientId: string, commands: Collection<string, SlashCommand>) {
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

		const data = (await rest.put(Routes.applicationCommands(clientId), { body: list })) as any;

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (err) {
		console.error(err);
	}
}
