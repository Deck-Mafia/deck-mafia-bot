import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { MessageFlags } from "discord.js";
import path, { join } from 'path';
import { database, prisma } from '..';
import config from '../config';
import { checkForRegularVoteCount, checkOnClose } from '../deckmafia/util/onTick';
import { calculateVoteCount, createVoteCountPost } from '../deckmafia/util/voteCount';
import { loadCommands, deckMafiaCommands } from '../structures/SlashCommand';
// TODO: DELETE AFTER MIGRATION – remove the import and the migration block in ClientReady
import { migrateFragments } from '../migrateFragments';

let tickCounter = 0;
let dbErrorUntil = 0;
let lastDbErrorLog = 0;

export const client = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});
const deckMafiaRest = new REST({ version: '10' }).setToken(config.discordBotToken);

client.on(Events.ClientReady, async (c) => {
	console.log(`Ready! Logged in as ${c.user.tag}`);
	
	try {
        console.log("Priming member cache...");
        const guilds = await client.guilds.fetch();
        for (const [id, oauthGuild] of guilds) {
            const guild = await oauthGuild.fetch();
            await guild.members.fetch(); 
            console.log(`Fetched ${guild.memberCount} members for ${guild.name}`);
        }
        console.log("Cache primed successfully.");
    } catch (err) {
        console.error("Failed to prime member cache:", err);
    }

	// TODO: DELETE AFTER MIGRATION – this block migrates old fragment OwnedCard rows to FragmentBalance
	try {
		const migrated = await migrateFragments(prisma as any);
		if (migrated) {
			console.log('Fragment migration completed. You can now remove the migration block from deckmafia.ts and delete src/migrateFragments.ts.');
		} else {
			console.log('Fragment migration: nothing to migrate (already done or no fragments exist).');
		}
	} catch (migErr) {
		console.error('Fragment migration failed:', migErr);
	}
	// END TODO: DELETE AFTER MIGRATION

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
        console.error('[COMMAND ERROR]', error);

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: 'There was an error while executing this command!',
                    flags: MessageFlags.Ephemeral
                }).catch(() => {});
            } else {
                await interaction.reply({
                    content: 'There was an error while executing this command!',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyErr) {
            console.error('[REPLY ERROR]', replyErr);
        }
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

				await i.reply({ content: 'Signups is no longer valid', flags: MessageFlags.Ephemeral });
				return;
			}

			const alreadyContains = signup.players.includes(joiningID);
			if (alreadyContains) {
				console.log('Already contains');
				await i.reply({ content: 'You are already signed up for this game.', flags: MessageFlags.Ephemeral });
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

			// const { embed, row } = createSignupPost(updated, i.guild);
			// i.message.edit({ embeds: [embed], components: [row] });
			await i.reply({ content: 'Successfully joined the signup', flags: MessageFlags.Ephemeral });
		} catch (err) {
			await i.reply({ content: 'Unable to join signups, try again later', flags: MessageFlags.Ephemeral });
		}
	} else if (customID == 'player-leave') {
		const leavingID = i.user.id;
		try {
			const signup = await prisma.signup.findFirst({ where: { id: cache } });
			if (!signup) {
				console.log('Signup no longer valid');

				await i.reply({ content: 'Signups is no longer valid', flags: MessageFlags.Ephemeral });
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

			// const { embed, row } = createSignupPost(updated, i.guild);
			// i.message.edit({ embeds: [embed], components: [row] });
			await i.reply({ content: 'Successfully left the signup, if you were in it.', flags: MessageFlags.Ephemeral });
		} catch (err) {
			await i.reply({ content: 'Unable to join signups, try again later', flags: MessageFlags.Ephemeral });
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

			if (card && card.card) urls.push(card.card.uri);
		}

		for (let index = 0; index < urls.length; index++) {
			if (i.channel?.isTextBased() && !i.channel.isDMBased()) {
				await i.channel.send({ content: `[${index + 1}/${urls.length}]<@${i.user.id}> has submitted\n${urls[index]}` });
			}
		}

		i.reply({ content: 'Done', flags: MessageFlags.Ephemeral });
	}
});

client.on(Events.ShardDisconnect, (e, id) => {
	console.log(e.code, e.reason, id);
});

export async function start() {
	await client.login(config.discordBotToken);
	setInterval(async () => {
			try{
			await tick(client);
		}	catch (err) {
			console.error('[TICK ERROR]', err);
		}
	}, 10000); // every 10 seconds
}	

async function tick(client: Client) {
    tickCounter++;

    if (tickCounter % 6 === 0) {
        //console.log(`[TICK PULSE] ${new Date().toISOString()} - Timer is alive`);
    }

    // ==================== RATE LIMIT PROTECTION ====================
    if (tickCounter % 18 === 0) {
        try {
            await client.guilds.fetch();
        } catch (err) {
            // Ignore fetch errors
        }
    }

    // ==================== DB ERROR BACKOFF ====================
    if (dbErrorUntil > 0) {
        if (Date.now() < dbErrorUntil) {
            // Throttle logging: only log every 5 minutes while waiting
            if (Date.now() - lastDbErrorLog > 300_000) {
                console.warn(`[TICK] DB unavailable, next retry in ~${Math.ceil((dbErrorUntil - Date.now()) / 1000)}s`);
                lastDbErrorLog = Date.now();
            }
            return;
        }
        // Backoff expired, reset and try again
        dbErrorUntil = 0;
    }

    let activeVoteCounts;
    try {
        activeVoteCounts = await database.voteCount.findMany({ where: { active: true } });
    } catch (err: any) {
        const isDbError = err?.code === 'P2010' || err?.message?.includes('timed out') || err?.message?.includes('Server selection timeout');
        if (isDbError) {
            const backoffMs = 60_000; // 60 second backoff
            dbErrorUntil = Date.now() + backoffMs;
            lastDbErrorLog = Date.now();
            console.error(`[TICK] Database unavailable (code: ${err?.code || 'unknown'}): ${err?.message?.slice(0, 200) || err}. Backing off for ${backoffMs / 1000}s.`);
        } else {
            console.error('[TICK ERROR]', err);
        }
        return;
    }

    if (activeVoteCounts.length === 0) return;

    //console.log(`[TICK] Processing ${activeVoteCounts.length} active vote counts`);

    for (const voteCount of activeVoteCounts) {
        // 1. Get the Guild
        let guild = client.guilds.cache.get(voteCount.guildId);

        if (!guild) {
            try {
                guild = await client.guilds.fetch(voteCount.guildId);
            } catch (err) {
                console.warn(`[TICK] Guild ${voteCount.guildId} not found. Deactivating.`);
                await database.voteCount.update({ where: { id: voteCount.id }, data: { active: false } });
                continue;
            }
        }

        try {
            // 2. Verify Channel exists (Self-Cleaning logic)
            const channel = await guild.channels.fetch(voteCount.channelId).catch(() => null);
            
            if (!channel) {
                console.warn(`[TICK] Channel ${voteCount.channelId} missing. Deactivating game ${voteCount.id}`);
                await database.voteCount.update({ 
                    where: { id: voteCount.id }, 
                    data: { active: false } 
                });
                continue; 
            }

            // 3. Handle Game Closing
            if (voteCount.closeAt) {
                await checkOnClose({ guild, voteCount });
            }

            // 4. Handle Periodic Public Vote Count
            if (voteCount.lastPeriod) {
                await checkForRegularVoteCount({ guild, voteCount });
            } else {
                // Initialize the timer if it doesn't exist so it starts working
                console.log(`[TICK] Initializing first timer for VoteCount ${voteCount.id}`);
                await database.voteCount.update({
                    where: { id: voteCount.id },
                    data: { lastPeriod: new Date(Date.now() + 1000 * 60 * 60 * 2) }
                });
            }
            
        } catch (err) {
            console.error(`[TICK ERROR] VoteCount ${voteCount.id} failed:`, err);
        }
    } // End of For Loop
}