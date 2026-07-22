// Browser-local copy of the 135-point fish-tail board movement rules.
import { ROWS, COLS, inPalace, inGrid, THREE_FACTIONS } from './constants.js';

export function keyOf(faction, row, col) {
  return `${faction}:${row}:${col}`;
}

export function parseKey(key) {
  const [faction, row, col] = String(key).split(':');
  return { faction, row: Number(row), col: Number(col) };
}

function hasPiece(board, key) {
  return Boolean(board.get(key)?.piece);
}

function buildRoutes() {
  const horizontal = [];
  const longitudinal = [];
  for (const faction of THREE_FACTIONS) {
    for (let row = 0; row < ROWS; row++) {
      horizontal.push({ type: 'horizontal', keys: Array.from({ length: COLS }, (_, col) => keyOf(faction, row, col)) });
    }
  }
  for (let i = 0; i < THREE_FACTIONS.length; i++) {
    const faction = THREE_FACTIONS[i];
    const next = THREE_FACTIONS[(i + 1) % THREE_FACTIONS.length];
    for (let col = 5; col < COLS; col++) {
      const targetCol = COLS - 1 - col;
      longitudinal.push({
        type: 'longitudinal',
        keys: [
          ...Array.from({ length: ROWS }, (_, row) => keyOf(faction, row, col)),
          ...Array.from({ length: ROWS }, (_, offset) => keyOf(next, ROWS - 1 - offset, targetCol)),
        ],
      });
    }
    longitudinal.push({
      type: 'longitudinal',
      keys: [
        ...Array.from({ length: ROWS }, (_, row) => keyOf(faction, row, 4)),
        ...Array.from({ length: ROWS }, (_, offset) => keyOf(next, ROWS - 1 - offset, 4)),
      ],
    });
  }
  return { horizontal, longitudinal, all: [...horizontal, ...longitudinal] };
}

export const ROUTES = buildRoutes();

function routesFor(key, type) {
  return (type ? ROUTES[type] : ROUTES.all).filter((route) => route.keys.includes(key));
}

function adjacentOnRoutes(key, type) {
  const out = [];
  for (const route of routesFor(key, type)) {
    const index = route.keys.indexOf(key);
    if (index > 0) out.push(route.keys[index - 1]);
    if (index + 1 < route.keys.length) out.push(route.keys[index + 1]);
  }
  return [...new Set(out)];
}

function dedupe(moves) {
  const seen = new Set();
  return moves.filter((move) => {
    if (seen.has(move.key)) return false;
    seen.add(move.key);
    return true;
  });
}

function generalMoves(faction, row, col, owner) {
  if (faction !== owner) return [];
  const moves = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = row + dr; const nc = col + dc;
    if (inPalace(nr, nc)) moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}

function advisorMoves(faction, row, col, owner) {
  if (faction !== owner) return [];
  const moves = [];
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const nr = row + dr; const nc = col + dc;
    if (inPalace(nr, nc)) moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}

function elephantMoves(board, faction, row, col, owner) {
  if (faction !== owner) return [];
  const moves = [];
  for (const [dr, dc] of [[-2, -2], [-2, 2], [2, -2], [2, 2]]) {
    const nr = row + dr; const nc = col + dc;
    if (!inGrid(nr, nc)) continue;
    if (hasPiece(board, keyOf(faction, row + dr / 2, col + dc / 2))) continue;
    moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}

function horseMoves(board, startKey) {
  const moves = [];
  for (const primaryType of ['horizontal', 'longitudinal']) {
    const secondaryType = primaryType === 'horizontal' ? 'longitudinal' : 'horizontal';
    for (const route of routesFor(startKey, primaryType)) {
      const startIndex = route.keys.indexOf(startKey);
      for (const direction of [-1, 1]) {
        const legIndex = startIndex + direction;
        const secondIndex = startIndex + direction * 2;
        if (legIndex < 0 || secondIndex < 0 || secondIndex >= route.keys.length) continue;
        if (hasPiece(board, route.keys[legIndex])) continue;
        for (const destination of adjacentOnRoutes(route.keys[secondIndex], secondaryType)) moves.push({ key: destination });
      }
    }
  }
  return dedupe(moves);
}

function chariotMoves(board, startKey) {
  const moves = [];
  for (const route of routesFor(startKey)) {
    const start = route.keys.indexOf(startKey);
    for (const direction of [-1, 1]) {
      for (let i = start + direction; i >= 0 && i < route.keys.length; i += direction) {
        const key = route.keys[i];
        moves.push({ key });
        if (hasPiece(board, key)) break;
      }
    }
  }
  return dedupe(moves);
}

function cannonMoves(board, startKey) {
  const moves = [];
  for (const route of routesFor(startKey)) {
    const start = route.keys.indexOf(startKey);
    for (const direction of [-1, 1]) {
      let screenFound = false;
      for (let i = start + direction; i >= 0 && i < route.keys.length; i += direction) {
        const key = route.keys[i];
        if (!screenFound) {
          if (hasPiece(board, key)) screenFound = true;
          else moves.push({ key });
        } else if (hasPiece(board, key)) {
          moves.push({ key });
          break;
        }
      }
    }
  }
  return dedupe(moves);
}

function pawnMoves(startKey, piece) {
  const { faction, row, col } = parseKey(startKey);
  const owner = piece.owner;
  const moves = [];
  if (faction === owner) {
    if (row < ROWS - 1) return [{ key: keyOf(faction, row + 1, col) }];
    for (const route of routesFor(startKey, 'longitudinal')) {
      const index = route.keys.indexOf(startKey);
      for (const direction of [-1, 1]) {
        const target = route.keys[index + direction];
        if (target && parseKey(target).faction !== owner) moves.push({ key: target });
      }
    }
    return dedupe(moves);
  }
  if (row > 0) moves.push({ key: keyOf(faction, row - 1, col) });
  if (col > 0) moves.push({ key: keyOf(faction, row, col - 1) });
  if (col + 1 < COLS) moves.push({ key: keyOf(faction, row, col + 1) });
  return moves;
}

export function getThreeValidMoves(board, key, moverFaction) {
  const cell = board.get(key);
  if (!cell?.piece || cell.owner !== moverFaction) return [];
  const { faction, row, col } = parseKey(key);
  if (!THREE_FACTIONS.includes(faction) || !inGrid(row, col)) return [];
  switch (cell.piece) {
    case 'general': return generalMoves(faction, row, col, cell.owner);
    case 'advisor': return advisorMoves(faction, row, col, cell.owner);
    case 'elephant': return elephantMoves(board, faction, row, col, cell.owner);
    case 'horse': return horseMoves(board, key);
    case 'chariot': return chariotMoves(board, key);
    case 'cannon': return cannonMoves(board, key);
    case 'pawn': return pawnMoves(key, cell);
    default: return [];
  }
}

export function canCapture(board, targetKey, moverFaction) {
  const target = board.get(targetKey);
  return Boolean(target?.piece && target.faction !== moverFaction);
}
