interface Config {
	discordBotToken: string;
	discordBotClientId: string;
}

export default {
	discordBotToken: process.env.DISCORD_BOT_TOKEN as string,
	discordBotClientId: process.env.DISCORD_BOT_CLIENT_ID as string,
} as Config;
