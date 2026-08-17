interface Config {
	discordBotToken: string;
	discordBotClientId: string;
	serverMain: string;
	serverGame: string;
	drawScopeGuildId: string;

	deiMilitesBotToken: string;
	deiMilitesClientId: string;
}

export default {
	discordBotToken: process.env.DISCORD_BOT_TOKEN as string,
	discordBotClientId: process.env.DISCORD_BOT_CLIENT_ID as string,
	serverMain: '830176736741163040',
	serverGame: '1012603013803814963',
	// Guild to instantly scope the /draw command to. Set empty (or unset DRAW_SCOPE_GUILD_ID)
	// to disable guild-scoping and rely on the global registration instead.
	drawScopeGuildId: process.env.DRAW_SCOPE_GUILD_ID || '1012603013803814963',
	deiMilitesBotToken: process.env.DEI_DISCORD_BOT_TOKEN as string,
	deiMilitesClientId: process.env.DEI_DISCORD_BOT_CLIENT as string,
} as Config;
