const { logger } = require('./logger.js');

let ws;

/**
 * Initializes a local reference of the websocket.
 */
function wsInit(_ws) {
	ws = _ws;
}

function sendChat(recipient, msg) {
	sendCmd('chatPM', { msg, recipient, room: 'lobby' });
}

function sendCmd(command, arg) {
	const cmd = command + ' ' + JSON.stringify(arg);
	logger.debug('sending cmd ' + cmd);
	ws.send(cmd);
}

function findOrder(hand, order) {
	return hand.find(c => c.order === order);
}

function handFind(hand, suitIndex, rank) {
	return hand.filter(c => cardMatch(c, suitIndex, rank));
}

function handFindInfer(hand, suitIndex, rank) {
	return hand.filter(c => {
		if (c.possible.length === 1) {
			return cardMatch(c.possible[0], suitIndex, rank);
		}
		else if (c.inferred.length === 1) {
			return cardMatch(c.inferred[0], suitIndex, rank);
		}
		return false;
	});
}

function visibleFind(state, target, suitIndex, rank, ignoreIndex = -1) {
	let found = [];
	for (let i = 0; i < state.hands.length; i++) {
		if (i === ignoreIndex) {
			continue;
		}

		const hand = state.hands[i];
		if (i === target || i === state.ourPlayerIndex) {
			found = found.concat(handFindInfer(hand, suitIndex, rank));
		}
		else {
			found = found.concat(handFind(hand, suitIndex, rank));
		}
	}
	return found;
}

const CARD_COUNT = [3, 2, 2, 2, 1];

function isCritical(state, suitIndex, rank) {
	return state.discard_stacks[suitIndex][rank - 1] === (CARD_COUNT[rank - 1] - 1);
}

function cardMatch(card, suitIndex, rank) {
	return card.suitIndex === suitIndex && card.rank === rank;
}

function intersectCards(cards1, cards2) {
	return cards1.filter(c1 => cards2.some(c2 => cardMatch(c1, c2.suitIndex, c2.rank)));
}

function subtractCards(cards1, cards2) {
	return cards1.filter(c1 => !cards2.some(c2 => cardMatch(c1, c2.suitIndex, c2.rank)));
}

function objClone(obj) {
	if (typeof obj === 'object' && !Array.isArray(obj)) {
		const new_obj = {};
		for (const [name, value] of Object.entries(obj)) {
			if (typeof value === 'function') {
				new_obj[name] = value;
			}
			else {
				new_obj[name] = JSON.parse(JSON.stringify(value));
			}
		}
		return new_obj;
	}
	else {
		return JSON.parse(JSON.stringify(obj));
	}
}

function cardToString(card) {
	const colours = ['r', 'y', 'g', 'b', 'p'];
	return colours[card.suitIndex] + card.rank;
}

function logHand(hand) {
	const copy = objClone(hand);
	for (const card of copy) {
		card.possible = card.possible.map(c => cardToString(c));
		card.inferred = card.inferred.map(c => cardToString(c));
	}
	return copy;
}

function writeNote(card, tableID) {
	let note = card.inferred.map(c => cardToString(c)).join(',');
	if (card.finessed) {
		note = `[f] [${note}]`;
	}

	note = `t${card.reasoning_turn.at(-1)}: ${note}`;

	sendCmd('note', { tableID, order: card.order, note });
}

module.exports = {
	CARD_COUNT,
	wsInit,
	sendChat, sendCmd,
	findOrder,
	handFind, visibleFind,
	isCritical,
	cardMatch, intersectCards, subtractCards,
	objClone,
	cardToString, logHand, writeNote
};
