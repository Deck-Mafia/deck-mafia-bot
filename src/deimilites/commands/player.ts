import { DeiMilitesGame, OwnedElement } from '@prisma/client';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, TextChannel } from 'discord.js';
import { prisma } from '../..';
import { newDeiMilitesCommand } from '../../structures/SlashCommand';
import { fetchGame, updateElements } from '../../util/deiActions';
import { checkIfHost } from '../utils/host';

const c = new SlashCommandBuilder();
c.setName('player');
c.setDescription('Manage an individual player');

c.addSubcommand((cmd) =>
	cmd
		.setName('newplayer')
		.setDescription('Create a new player')
		.addUserOption((user) => user.setName('player').setDescription('Player you wish to add').setRequired(true))
);

c.addSubcommand((cmd) =>
	cmd
		.setName('inventory')
		.setDescription('View the inventory of a player')
		.addUserOption((user) => user.setName('player').setDescription('Player you wish to see the inventory from').setRequired(true))
);

c.addSubcommand((cmd) =>
	cmd
		.setName('health')
		.setDescription('Manage the health of a player')
		.addUserOption((user) => user.setName('player').setDescription('Player you are referring to').setRequired(true))
		.addIntegerOption((int) => int.setName('add').setDescription('How much HP do you wish to add?').setRequired(false))
		.addIntegerOption((int) => int.setName('remove').setDescription('How much HP do you wish to remove?').setRequired(false))
);

c.addSubcommand((cmd) =>
	cmd
		.setName('chel')
		.setDescription('Manage the Chel of a player')
		.addUserOption((user) => user.setName('player').setDescription('Player you are referring to').setRequired(true))
		.addIntegerOption((int) => int.setName('add').setDescription('How much Chel do you wish to add?').setRequired(false))
		.addIntegerOption((int) => int.setName('remove').setDescription('How much Chel do you wish to remove?').setRequired(false))
);

// IMPLEMENT THE FOLLOWING
c.addSubcommand((cmd) =>
	cmd
		.setName('elements')
		.setDescription('Manage the element of a player')
		.addUserOption((user) => user.setName('player').setDescription('Player you are referring to').setRequired(true))
		.addStringOption((str) => str.setName('element').setDescription('What element do you wish to manage?').setRequired(true))
		.addIntegerOption((int) => int.setName('add').setDescription('How much of this element do you wish to add?').setRequired(false))
		.addIntegerOption((int) => int.setName('remove').setDescription('How much of this element do you wish to remove?').setRequired(false))
);

export default newDeiMilitesCommand({
	data: c,
	async execute(i: ChatInputCommandInteraction) {
		try {
			const subcommand = i.options.getSubcommand();
			const game = await fetchGame(i.channel as TextChannel);
			if (!game) return i.reply('Cannot use this command outside of a game');
			const isHost = checkIfHost(game, i.user.id);
			if (!isHost) return i.reply('Only a host can use this command');

			const playerAccount = i.options.getUser('player', true);
			const player = await prisma.deiMilitesPlayer.findFirst({
				where: {
					game: { id: game.id },
					account: {
						discordId: playerAccount.id,
					},
				},
				include: {
					ownedElements: {
						include: {
							element: true,
						},
					},
					game: true,
				},
			});
			if (!player) return i.reply('Cannot use this command on someone that is not a player');

			switch (subcommand) {
				case 'inventory':
					return inventory(i, game);
				case 'chel':
					const addChel = i.options.getInteger('add') ?? 0;
					const removeChel = i.options.getInteger('remove') ?? 0;

					const updateChelPlayer = await prisma.deiMilitesPlayer.update({
						where: { id: player.id },
						data: {
							chel: Math.max(0, player.chel + addChel - removeChel),
						},
					});

					return await i.reply({
						content: `<@${playerAccount.id}> now has ${updateChelPlayer.chel} chel.`,
						options: {
							allowedMentions: {
								users: [],
							},
						},
					});
				case 'health':
					const healHP = i.options.getInteger('add') ?? 0;
					const damageHP = i.options.getInteger('remove') ?? 0;

					const updateHPPlayer = await prisma.deiMilitesPlayer.update({
						where: { id: player.id },
						data: {
							health: Math.max(0, player.health + healHP - damageHP),
						},
					});

					return await i.reply({
						content: `<@${playerAccount.id}> now has ${updateHPPlayer.health} HP.`,
						options: {
							allowedMentions: {
								users: [],
							},
						},
					});
				case 'elements':
					const element = i.options.getString('element', true);
					const addElements = i.options.getInteger('add', false) ?? 0;
					const removeElements = i.options.getInteger('remove', false) ?? 0;

					let ownedElement: OwnedElement | undefined;
					player.ownedElements.forEach((el) => {
						if (el.element.name === element) {
							ownedElement = el;
						}
					});

					if (ownedElement) {
						const updatedElement = await prisma.ownedElement.update({
							where: {
								id: ownedElement.id,
							},
							data: {
								amount: ownedElement.amount + addElements - removeElements,
							},
						});

						await i.reply({ embeds: [updateElements(playerAccount.id, element, updatedElement.amount)] });
					} else {
						const newOwnedElement = await prisma.ownedElement.create({
							data: {
								element: {
									connectOrCreate: {
										create: {
											name: element,
											game: {
												connect: {
													id: player.gameId,
												},
											},
										},
										where: {
											name_gameId: {
												gameId: player.gameId,
												name: element,
											},
										},
									},
								},
								player: {
									connect: {
										id: player.id,
									},
								},
								amount: Math.max(0, addElements - removeElements),
							},
						});

						await i.reply({ embeds: [updateElements(playerAccount.id, element, newOwnedElement.amount)] });
					}

					break;
			}
		} catch (err) {
			console.log(err);
			await i.reply('An error has occurred');
		}
	},
});

async function inventory(i: ChatInputCommandInteraction, game: DeiMilitesGame) {
	const user = i.options.getUser('player', true);

	const player = await prisma.deiMilitesPlayer.findFirst({
		where: {
			game: { id: game.id },
			account: {
				discordId: user.id,
			},
		},
		include: {
			ownedElements: {
				include: {
					element: true,
				},
			},
		},
	});

	if (!player) return i.reply('Cannot use this command on someone that is not a player');

	try {
		const embed = new EmbedBuilder();
		embed.setTitle('Inventory');
		embed.setColor(0xf8a211);
		embed.setThumbnail(user.avatarURL());
		embed.setDescription('Please avoid showing this to players');
		embed.addFields(
			{
				name: 'Player',
				value: `<@${user.id}>`,
			},
			{
				name: 'HP',
				value: `> ${player.health}`,
				inline: true,
			},
			{
				name: 'Chel',
				value: `> ${player.chel}`,
				inline: true,
			}
			// {
			// 	name: 'Affinity',
			// 	value: '> Unknown (mastered)',
			// },
			// {
			// 	name: 'Class',
			// 	value: '> None',
			// 	inline: false,
			// },
			// {
			// 	name: 'Animals',
			// 	value: '> Male Falcon (Bird), Female Falcon (Aves)',
			// 	inline: false,
			// },
			// {
			// 	name: 'Weapons',
			// 	value: '> None',
			// 	inline: true,
			// },
			// {
			// 	name: 'Armour',
			// 	value: '> None',
			// 	inline: true,
			// },
			// {
			// 	name: 'Summons',
			// 	value: '> None',
			// 	inline: true,
			// }
		);

		const elementsArray = [];
		for (let i = 0; i < player.ownedElements.length; i++) {
			const ownedElement = player.ownedElements[i];
			elementsArray.push(`> ${ownedElement.amount} ${ownedElement.element.name} elements`);
		}
		let elementString = elementsArray.join('\n').trim();
		if (elementString == '') elementString = 'None';

		embed.addFields({
			name: 'Elements',
			value: elementString,
		});

		await i.reply({ embeds: [embed] });
	} catch (err) {
		console.log(err);
		await i.reply({ content: 'An error has occurred', ephemeral: true });
	}
}
