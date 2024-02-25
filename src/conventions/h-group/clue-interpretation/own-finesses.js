import { LEVEL } from '../h-constants.js';
import { playableAway } from '../../../basics/hanabi-util.js';
import { find_possibilities } from '../../../basics/helper.js';
import { find_connecting } from './connecting-cards.js';
import { cardTouched } from '../../../variants.js';

import logger from '../../../tools/logger.js';
import { logCard } from '../../../tools/log.js';

class IllegalInterpretation extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
	}
}

/**
 * @typedef {import('../../h-group.js').default} State
 * @typedef {import('../../../basics/Card.js').ActualCard} ActualCard
 * @typedef {import('../../../types.js').Connection} Connection
 * @typedef {import('../../../types.js').Identity} Identity
 */

/**
 * @param {State} state
 * @param {number} finesses
 * @param {ActualCard} prompt
 * @param {Identity} identity
 * @returns {Connection[]}
 */
function own_prompt(state, finesses, prompt, identity) {
	if (state.level === 1 && finesses >= 1)
		throw new IllegalInterpretation('Blocked prompt + finesse at level 1');

	const card = state.me.thoughts[prompt.order];
	const reacting = state.ourPlayerIndex;

	if (card.rewinded && identity.suitIndex !== prompt.suitIndex && playableAway(state, prompt) === 0) {
		if (state.level < LEVEL.INTERMEDIATE_FINESSES)
			throw new IllegalInterpretation('Blocked hidden finesse at level 1');

		return [{ type: 'known', reacting, card: prompt, hidden: true, self: true, identities: [prompt.raw()] }];
	}

	if (card.matches(identity, { assume: true }))
		return [{ type: 'prompt', reacting, card: prompt, self: true, identities: [identity] }];

	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {State} state
 * @param {number} giver
 * @param {number} target
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number[]} ignoreOrders
 * @param {number} ignorePlayer
 * @param {number[]} selfRanks
 * @param {number} finesses
 * @returns {Connection[]}
 */
function connect(state, giver, target, identity, looksDirect, ignoreOrders, ignorePlayer, selfRanks, finesses) {
	const our_hand = state.hands[state.ourPlayerIndex];

	// First, see if someone else has the connecting card
	const other_connecting = find_connecting(state, giver, target, identity, looksDirect, ignoreOrders, { knownOnly: [ignorePlayer] });
	if (other_connecting.length > 0)
		return other_connecting;

	if (giver !== state.ourPlayerIndex) {
		// Otherwise, try to find prompt in our hand
		const prompt = state.common.find_prompt(our_hand, identity, state.variant.suits, ignoreOrders);
		logger.debug('prompt in slot', prompt ? our_hand.findIndex(c => c.order === prompt.order) + 1 : '-1');

		if (prompt !== undefined) {
			const connections = own_prompt(state, finesses, prompt, identity);

			if (connections.length > 0)
				return connections;
		}
		else if (!selfRanks.includes(identity.rank)) {
			try {
				return find_self_finesse(state, identity, ignoreOrders.slice(), finesses);
			}
			catch (error) {
				logger.warn(error.message);
			}
		}
	}

	// Use the ignoring player's hand
	if (ignorePlayer !== -1) {
		const their_hand = state.hands[ignorePlayer];
		const prompt = state.common.find_prompt(their_hand, identity, state.variant.suits, ignoreOrders);

		if (prompt !== undefined) {
			if (state.level === 1 && finesses >= 1)
				throw new IllegalInterpretation('Blocked double finesse at level 1');

			if (state.common.thoughts[prompt.order].matches(identity, { assume: true }))
				return [{ type: 'prompt', reacting: target, card: prompt, self: true, identities: [identity] }];
		}
		else {
			const finesse = state.common.find_finesse(their_hand, ignoreOrders);

			if (finesse) {
				const card = state.common.thoughts[finesse.order];

				if (card.inferred.some(p => p.matches(identity)) && card.matches(identity, { assume: true })) {
					if (state.level === 1 && ignoreOrders.length >= 1)
						throw new IllegalInterpretation('Blocked double finesse at level 1');

					return [{ type: 'finesse', reacting: target, card: finesse, self: true, identities: [identity] }];
				}
			}
		}

		// Try finesse in our hand again (if we skipped it earlier to prefer ignoring player)
		if (giver !== state.ourPlayerIndex && selfRanks.includes(identity.rank)) {
			try {
				return find_self_finesse(state, identity, ignoreOrders.slice(), finesses);
			}
			catch (error) {
				logger.warn(error.message);
			}
		}
	}
	return [];
}

/**
 * Looks for a connecting card, resorting to a prompt/finesse through own hand if necessary.
 * @param {State} state
 * @param {number} giver
 * @param {number} target
 * @param {Identity} identity
 * @param {boolean} looksDirect
 * @param {number} [ignorePlayer]
 * @param {number[]} [selfRanks]
 * @returns {{feasible: boolean, connections: Connection[]}}
 */
export function find_own_finesses(state, giver, target, { suitIndex, rank }, looksDirect, ignorePlayer = -1, selfRanks = []) {
	try {
		// We cannot finesse ourselves
		if (giver === state.ourPlayerIndex && ignorePlayer === -1)
			throw new IllegalInterpretation('Cannot finesse ourselves.');

		// Create hypothetical state where we have the missing cards (and others can elim from them)
		const hypo_state = state.minimalCopy();

		const connections = /** @type {Connection[]} */ ([]);
		const ignoreOrders = /** @type {number[]} */ ([]);
		let finesses = 0;

		for (let next_rank = hypo_state.play_stacks[suitIndex] + 1; next_rank < rank; next_rank++) {
			const next_identity = { suitIndex, rank: next_rank };
			const currIgnoreOrders = ignoreOrders.concat(state.next_ignore[next_rank - hypo_state.play_stacks[suitIndex] - 1] ?? []);

			const curr_connections = connect(hypo_state, giver, target, next_identity, looksDirect, currIgnoreOrders, ignorePlayer, selfRanks, finesses);

			if (curr_connections.length === 0)
				throw new IllegalInterpretation(`No connecting cards found for identity ${logCard(next_identity)}`);

			let allHidden = true;
			for (const connection of curr_connections) {
				connections.push(connection);

				const { card, hidden, type } = connection;

				if (type === 'finesse')
					finesses++;

				if (hidden) {
					const id = card.identity();

					if (id !== undefined) {
						hypo_state.play_stacks[id.suitIndex]++;
						hypo_state.common.hypo_stacks[id.suitIndex]++;		// Everyone knows this card is playing
					}
				}
				else {
					allHidden = false;

					// Assume this is actually the card
					hypo_state.common.thoughts[card.order].intersect('inferred', [next_identity]);
					hypo_state.common.good_touch_elim(hypo_state);
				}
				ignoreOrders.push(card.order);
			}

			// Hidden connection, need to look for this rank again
			if (allHidden)
				next_rank--;
		}
		return { feasible: true, connections };
	}
	catch (error) {
		logger.warn(error.message);
		return { feasible: false, connections: [] };
	}
}

/**
 * @param {State} state
 * @param {Identity} identity
 * @param {number[]} ignoreOrders
 */
function resolve_layered_finesse(state, identity, ignoreOrders) {
	const our_hand = state.hands[state.ourPlayerIndex];

	/** @type {Connection[]} */
	const connections = [];

	for (const action of state.next_finesse) {
		const start_index = our_hand.findIndex(c => c.order === state.common.find_finesse(our_hand, ignoreOrders).order);
		const { list, clue } = action;

		// Touching a matching card to the finesse - all untouched cards are layered
		// Touching a non-matching card - all touched cards are layered
		const matching = cardTouched(identity, state.variant, clue);

		logger.info(start_index, matching, list.includes(our_hand[start_index].order));

		for (let i = start_index; matching !== list.includes(our_hand[i].order); i++) {
			logger.info('hi', i);
			if (i === our_hand.length)
				throw new IllegalInterpretation('Blocked layered finesse with no end');

			const card = our_hand[i];
			let identities = state.common.hypo_stacks.map((stack_rank, suitIndex) => ({ suitIndex, rank: stack_rank + 1 }));

			// Touching a non-matching card - we know exactly what playbable identities it should be
			if (!matching) {
				const possibilities = find_possibilities(clue, state.variant);
				identities = identities.filter(card => possibilities.some(p => p.suitIndex === card.suitIndex && p.rank === identity.rank));
			}

			connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card, hidden: true, self: true, identities });
			state.common.thoughts[card.order].intersect('inferred', identities);
			ignoreOrders.push(card.order);
		}
	}

	// Assume next card is the finesse target
	const finesse = state.common.find_finesse(our_hand, ignoreOrders);

	// Layered finesse is impossible
	if (finesse === undefined)
		throw new IllegalInterpretation(`Couldn't find a valid finesse target after layers`);

	connections.push({ type: 'finesse', reacting: state.ourPlayerIndex, card: finesse, self: true, identities: [identity] });
	return connections;
}

/**
 * @param {State} state
 * @param {Identity} identity
 * @param {number[]} ignoreOrders
 * @param {number} finesses
 * @returns {Connection[]}
 */
function find_self_finesse(state, identity, ignoreOrders, finesses) {
	const our_hand = state.hands[state.ourPlayerIndex];

	const finesse = state.common.find_finesse(our_hand, ignoreOrders);
	logger.debug('finesse in slot', finesse ? our_hand.findIndex(c => c.order === finesse.order) + 1 : '-1');

	if (finesse === undefined)
		throw new IllegalInterpretation('No finesse slot');

	const card = state.me.thoughts[finesse.order];
	const reacting = state.ourPlayerIndex;

	if (card.rewinded && finesse.suitIndex !== identity.suitIndex && playableAway(state, finesse) === 0) {
		if (state.level < LEVEL.INTERMEDIATE_FINESSES)
			throw new IllegalInterpretation(`Blocked layered finesse at level ${state.level}`);

		return [{ type: 'finesse', reacting, card: finesse, hidden: true, self: true, identities: [finesse.raw()] }];
	}

	if (card.inferred.some(p => p.matches(identity)) && card.matches(identity, { assume: true })) {
		if (state.level === 1 && ignoreOrders.length >= 1)
			throw new IllegalInterpretation(`Blocked ${finesses >= 1 ? 'double finesse' : 'prompt + finesse'} at level 1`);

		// We have some information about the next finesse
		if (state.next_finesse.length > 0)
			return resolve_layered_finesse(state, identity, ignoreOrders);

		return [{ type: 'finesse', reacting, card: finesse, self: true, identities: [identity] }];
	}

	throw new IllegalInterpretation('Self-finesse not found');
}