interface Config {
	discordBotToken: string;
	discordBotClientId: string;
	serverMain: string;
	serverGame: string;

	deiMilitesBotToken: string;
	deiMilitesClientId: string;
}

export default {
	discordBotToken: process.env.DISCORD_BOT_TOKEN as string,
	discordBotClientId: process.env.DISCORD_BOT_CLIENT_ID as string,
	serverMain: '830176736741163040',
	serverGame: '1012603013803814963',
	deiMilitesBotToken: process.env.DEI_DISCORD_BOT_TOKEN as string,
	deiMilitesClientId: process.env.DEI_DISCORD_BOT_CLIENT as string,
} as Config;
