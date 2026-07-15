import { REST, Routes, Client, Collection, CommandInteraction, SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import path from 'path';
import fs from 'fs';
import config from '../config';

export const deckMafiaCommands: Collection<string, SlashCommand> = new Collection();
export const deiMilitesCommands: Collection<string, SlashCommand> = new Collection();

export interface SlashCommand {
	data: SlashCommandBuilder;
	execute: (i: ChatInputCommandInteraction) => any | Promise<any>;
	guildId?: string; // If set, command is only registered to this guild
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
		// Separate guild-locked and global commands
		const globalCommands: any[] = [];
		const guildCommands: Map<string, any[]> = new Map();

		commands.forEach((val) => {
			if (val.guildId) {
				const existing = guildCommands.get(val.guildId) || [];
				existing.push(val.data.toJSON());
				guildCommands.set(val.guildId, existing);
			} else {
				globalCommands.push(val.data.toJSON());
			}
		});

		// Register global commands
		if (globalCommands.length > 0) {
			const data = (await rest.put(Routes.applicationCommands(clientId), { body: globalCommands })) as any;
			console.log(`Successfully reloaded ${data.length} global application (/) commands.`);
		}

		// Register guild-locked commands
		for (const [guildId, cmds] of guildCommands) {
			const data = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: cmds })) as any;
			console.log(`Successfully reloaded ${data.length} guild-locked commands for guild ${guildId}.`);
		}
	} catch (err) {
		console.error(err);
	}
}
