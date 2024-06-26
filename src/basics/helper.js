import { visibleFind } from './hanabi-util.js';

import logger from '../tools/logger.js';
import { logCard } from '../tools/log.js';

/**
 * @typedef {import('./Game.js').Game} Game
 * @typedef {import('./State.js').State} State
 * @typedef {import('./Player.js').Player} Player
 * @typedef {import('./Card.js').Card} Card
 * @typedef {import('./Card.js').BasicCard} BasicCard
 * @typedef {import('../types.js').BaseClue} BaseClue
 * @typedef {import('../types.js').Clue} Clue
 * @typedef {import('../types.js').Identity} Identity
 * @typedef {import('../types.js').ClueAction} ClueAction
 * @typedef {import('../variants.js').Variant} Variant
 */

/**
 * Updates all players with info from common knowledge.
 * @param {Game} game
 */
export function team_elim(game) {
	const { state } = game;

	for (const player of game.players) {
		for (let i = 0; i < game.common.thoughts.length; i++) {
			const card = player.thoughts[i];
			const ccard = game.common.thoughts[i];

			card.possible = ccard.possible.intersect(card.possible);
			card.inferred = ccard.inferred.intersect(card.possible);

			// Reset to GTP if common interpretation doesn't make sense
			if (card.inferred.length === 0)
				card.inferred = card.possible;

			card.old_inferred = ccard.old_inferred;

			for (const property of ['focused', 'finessed', 'chop_moved', 'reset', 'chop_when_first_clued', 'hidden', 'called_to_discard', 'finesse_index', 'rewinded', 'certain_finessed'])
				card[property] = ccard[property];

			card.reasoning = ccard.reasoning.slice();
			card.reasoning_turn = ccard.reasoning_turn.slice();
		}

		player.waiting_connections = game.common.waiting_connections.slice();
		player.good_touch_elim(state, state.numPlayers === 2);
		player.refresh_links(state);
		player.update_hypo_stacks(state);
	}
}

/**
 * @param {Game} game
 * @param {Card[]} oldThoughts
 * @param {ClueAction} clueAction
 */
export function checkFix(game, oldThoughts, clueAction) {
	const { giver, list, target } = clueAction;
	const { common, state } = game;

	const clue_resets = new Set();
	for (const { order } of state.hands[target]) {
		if (oldThoughts[order].inferred.length > 0 && common.thoughts[order].inferred.length === 0) {
			common.reset_card(order);
			clue_resets.add(order);
		}
	}

	const resets = common.good_touch_elim(state);
	common.refresh_links(state);

	// Includes resets from negative information
	const all_resets = new Set([...clue_resets, ...resets]);

	if (all_resets.size > 0) {
		// TODO: Support undoing recursive eliminations by keeping track of which elims triggered which other elims
		const infs_to_recheck = Array.from(all_resets).map(order => oldThoughts[order].identity({ infer: true })).filter(id => id !== undefined);

		for (const inf of infs_to_recheck)
			common.restore_elim(inf);
	}

	// Any clued cards that lost all inferences
	const clued_reset = list.some(order => all_resets.has(order) && !state.hands[target].findOrder(order).newly_clued);

	const duplicate_reveal = state.hands[target].some(({ order }) => {
		const card = common.thoughts[order];

		// The fix can be in anyone's hand except the giver's
		return game.common.thoughts[order].identity() !== undefined &&
			visibleFind(state, common, card.identity(), { ignore: [giver], infer: true }).some(c => common.thoughts[c.order].touched && c.order !== order);
	});

	return clued_reset || duplicate_reveal;
}

/**
 * Reverts the hypo stacks of the given suitIndex to the given rank - 1, if it was originally above that.
 * @param {Game} game
 * @param {Identity} identity
 */
export function undo_hypo_stacks(game, { suitIndex, rank }) {
	logger.info(`discarded useful card ${logCard({suitIndex, rank})}, setting hypo stack to ${rank - 1}`);
	game.common.hypo_stacks[suitIndex] = Math.min(game.common.hypo_stacks[suitIndex], rank - 1);
}

/**
 * Resets superposition on all cards.
 * @param {Game} game
 */
export function reset_superpositions(game) {
	for (const { order } of game.state.hands.flat())
		game.common.thoughts[order].superposition = false;
}
