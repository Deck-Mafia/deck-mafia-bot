import { ChannelType, ChatInputCommandInteraction, CommandInteraction, EmbedBuilder, SlashCommandBuilder, TextChannel } from 'discord.js';
import { database, prisma } from '../..';
import { newSlashCommand, SlashCommand } from '../../structures/SlashCommand';
import { checkGameInCategory, createGame, createPlayer } from '../util/voteCount';

const c = new SlashCommandBuilder();
c.setName('votecount').setDescription('Manage a vote-counter');

c.addSubcommand((x) =>
	x
		.setName('create')
		.setDescription('Create a vote-counter in the designated channel')
		.addRoleOption((x) => x.setName('alive').setDescription('Role which they have when alive').setRequired(true))
		.addBooleanOption((x) => x.setName('majority').setDescription('Enable majority').setRequired(false))
		.addBooleanOption((x) => x.setName('plurality').setDescription('Enable plurality').setRequired(false))
		.addBooleanOption((x) => x.setName('locked').setDescription('Lock votes. Votes cannot be changed once they have been made').setRequired(false))
);

c.addSubcommand((x) =>
	x
		.setName('event')
		.setDescription('Add a new event to the game. Ignore any values to keep them the same')
		.addUserOption((x) => x.setName('player').setDescription('Player you are updating a value for').setRequired(true))
		.addBooleanOption((x) => x.setName('vote').setDescription('Can this player vote?').setRequired(false))
		.addBooleanOption((x) => x.setName('recipient').setDescription('Can this user be voted?').setRequired(false))
		.addBooleanOption((x) => x.setName('majority').setDescription('Does this player count towards majority').setRequired(false))
		.addIntegerOption((x) => x.setName('weight').setDescription('What is the vote weight this player has?').setRequired(false))
		.addUserOption((x) => x.setName('voting').setDescription('Who is this player voting for?').setRequired(false))
		.addUserOption((x) => x.setName('unvote').setDescription('Remove the vote from a player.').setRequired(false))
);

export default newSlashCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		if (!i.guild) return;
		switch (i.options.getSubcommand(true)) {
			case 'create':
				return createVoteCount(i);
			case 'event':
				return createEvent(i);
			default:
				return;
		}
	},
});

async function createEvent(i: ChatInputCommandInteraction) {
	if (!i.guild) return;
	await i.deferReply({ ephemeral: true });

	const player = i.options.getUser('player', true);
	const canVote = i.options.getBoolean('vote', false);
	const canBeVoted = i.options.getBoolean('recipient', false);
	const countsForMajority = i.options.getBoolean('majority', false);
	const isUnvoting = i.options.getBoolean('unvote', false);
	const voteWeight = i.options.getInteger('weight', false);
	const votingPlayer = i.options.getUser('voting', false);
	try {
	} catch (err) {
		return i.editReply('An error has occurred. Error handling not yet implemented');
	}
}

async function createVoteCount(i: ChatInputCommandInteraction) {
	if (!i.guild) return;
	await i.deferReply({ ephemeral: true });

	const channel = i.channel as TextChannel;
	const role = i.options.getRole('alive', true);
	const majority = i.options.getBoolean('majority') || false;
	const plurality = i.options.getBoolean('plurality') ?? true;
	const votesLocked = i.options.getBoolean('locked') ?? false;
	const categoryId = channel.parentId;
	if (!categoryId) return i.editReply({ content: 'Channel needs to be in a category registered as a game' });

	try {
		const existingVoteCount = await database.voteCount.findUnique({ where: { channelId: channel.id } });
		if (existingVoteCount) return i.editReply('A vote counter already exists in this channel');

		const voteCount = await database.voteCount.create({
			data: {
				channelId: channel.id,
				livingRoleId: role.id,
				lockedVotes: votesLocked,
				majority,
				plurality,
			},
		});

		if (!voteCount) return i.editReply('Unable to create a new vote-count here');
		// const voteCountPost = await createVoteCountPost(i.guild, voteCount);
		return i.editReply('Created');
	} catch (err) {
		return i.editReply('An error has occurred. Error handling not yet implemented');
	}
}
