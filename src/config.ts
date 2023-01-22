interface Config {
	discordBotToken: string;
	discordBotClientId: string;

	deiMilitesBotToken: string;
	deiMilitesClientId: string;
}

export default {
	discordBotToken: process.env.DISCORD_BOT_TOKEN as string,
	discordBotClientId: process.env.DISCORD_BOT_CLIENT_ID as string,
	deiMilitesBotToken: process.env.DEI_DISCORD_BOT_TOKEN as string,
	deiMilitesClientId: process.env.DEI_DISCORD_BOT_CLIENT as string,
} as Config;
