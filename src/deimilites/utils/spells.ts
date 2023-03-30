import { EmbedBuilder } from '@discordjs/builders';
import { Spell } from '@prisma/client';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../..';

interface SpellCreationQuery {
	name: string;
	description: string;
	cost: string;
	sideEffects?: string;
	hidden?: string;
}

export async function getSpell(categoryId: string, spellName: string) {
	const spell = await prisma.spell.findFirst({
		where: {
			game: {
				gameCategoryId: categoryId,
			},
			name: {
				equals: spellName,
				mode: 'insensitive',
			},
		},
	});

	console.log(spell);

	return spell;
}

enum SpellCreationResult {
	SUCCESS,
	FAILURE,
	CONFLICT,
}

type SpellCreationResponse = { spell: Spell | null; status: SpellCreationResult };

export async function createSpell(categoryId: string, { name, description, cost, sideEffects, hidden }: SpellCreationQuery): Promise<SpellCreationResponse> {
	const [spell] = await Promise.allSettled([getSpell(categoryId, name)]);
	if (spell.status == 'rejected') return { spell: null, status: SpellCreationResult.FAILURE };
	if (spell.value != null) return { spell: null, status: SpellCreationResult.CONFLICT };

	const [newSpell] = await Promise.allSettled([
		prisma.spell.create({
			data: {
				name,
				description,
				cost,
				sideEffects,
				hidden,
				game: {
					connect: {
						gameCategoryId: categoryId,
					},
				},
			},
		}),
	]);

	if (newSpell.status == 'rejected') return { spell: null, status: SpellCreationResult.FAILURE };
	return { spell: newSpell.value, status: SpellCreationResult.SUCCESS };
}

export function createSpellPost(spell: Spell): { embed: EmbedBuilder; hostrow: ActionRowBuilder<ButtonBuilder> } {
	const embed = new EmbedBuilder();
	embed.setTitle(`${spell.name}`);
	embed.setColor(0xff4145);
	embed.addFields(
		{
			name: 'Description',
			value: spell.description,
		},
		{
			name: 'Cost',
			value: spell.cost,
		}
	);

	if (spell.sideEffects)
		embed.addFields({
			name: 'Side Effects',
			value: spell.sideEffects,
		});

	if (spell.hidden)
		embed.addFields({
			name: 'Hidden Aspect/s',
			value: spell.hidden,
		});

	const hostrow = new ActionRowBuilder<ButtonBuilder>();
	// hostrow.addComponents(new ButtonBuilder().setCustomId('cast').setEmoji('🪄').setStyle(ButtonStyle.Secondary).setLabel('Cast'));
	// hostrow.addComponents(new ButtonBuilder().setCustomId('give').setEmoji('🫳').setStyle(ButtonStyle.Secondary).setLabel('Give'));
	// hostrow.addComponents(new ButtonBuilder().setCustomId('take').setEmoji('🫴').setStyle(ButtonStyle.Secondary).setLabel('Take'));
	// hostrow.addComponents(new ButtonBuilder().setCustomId('edit').setEmoji('⚙️').setStyle(ButtonStyle.Secondary).setLabel('Edit'));

	return { embed, hostrow };
}
