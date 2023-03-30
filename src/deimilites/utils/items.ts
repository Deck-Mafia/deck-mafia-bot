import { Item, Spell } from '@prisma/client';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { database } from '../..';

interface ItemCreationQuery {
	name: string;
	effect: string;
	cost: string | undefined;
	hidden: string | undefined;
}

enum ItemCreationStatus {
	SUCCESS,
	FAILURE,
	CONFLICT,
}

type ItemCreationResponse = { item: Item | null; status: ItemCreationStatus };

export async function getItem(categoryId: string, itemName: string) {
	const item = await database.item.findFirst({
		where: {
			game: {
				gameCategoryId: categoryId,
			},
			name: {
				equals: itemName,
				mode: 'insensitive',
			},
		},
	});

	return item;
}

export async function createItem(categoryId: string, { name, effect, cost, hidden }: ItemCreationQuery) {
	try {
		const conflictCheck = await getItem(categoryId, name);
		if (conflictCheck) return { spell: null, status: ItemCreationStatus.CONFLICT };

		const newItem = await database.item.create({
			data: {
				name,
				effect,
				cost,
				hidden,
				game: {
					connect: {
						gameCategoryId: categoryId,
					},
				},
			},
		});

		return { item: newItem, status: ItemCreationStatus.SUCCESS };
	} catch (err) {
		console.log(err);
		return { spell: null, status: ItemCreationStatus.FAILURE };
	}
}

export function createItemPost(item: Item): { embed: EmbedBuilder; hostrow: ActionRowBuilder<ButtonBuilder> } {
	const embed = new EmbedBuilder();
	embed.setTitle(`${item.name}`);
	embed.setColor(0xff4145);
	embed.addFields(
		{
			name: 'Effect',
			value: item.effect,
		},
		{
			name: 'Cost',
			value: item.cost ?? 'Not for Sale',
		}
	);

	if (item.hidden)
		embed.addFields({
			name: 'Hidden Aspect/s',
			value: item.hidden,
		});

	const hostrow = new ActionRowBuilder<ButtonBuilder>();
	// hostrow.addComponents(new ButtonBuilder().setCustomId('give').setEmoji('🫳').setStyle(ButtonStyle.Secondary).setLabel('Give'));
	// hostrow.addComponents(new ButtonBuilder().setCustomId('take').setEmoji('🫴').setStyle(ButtonStyle.Secondary).setLabel('Take'));
	// hostrow.addComponents(new ButtonBuilder().setCustomId('edit').setEmoji('⚙️').setStyle(ButtonStyle.Secondary).setLabel('Edit'));

	return { embed, hostrow };
}
