// 三人模式走法 —— 客户端 ESM 版（与服务端逻辑一致）。
import { ROWS, COLS, inPalace, inGrid, THREE_FACTIONS } from './constants.js';

export function keyOf(faction, row, col) {
  return `${faction}:${row}:${col}`;
}
export function isCenter(key) { return key === 'center'; }
export function parseKey(key) {
  if (key === 'center') return { center: true };
  const [faction, row, col] = key.split(':');
  return { faction, row: Number(row), col: Number(col) };
}

function hasPiece(board3, key) {
  const c = board3.get(key);
  return !!c && !!c.piece;
}

function generalMoves(board3, faction, row, col) {
  const moves = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = row + dr; const nc = col + dc;
    if (inPalace(nr, nc)) moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}
function advisorMoves(board3, faction, row, col) {
  const moves = [];
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const nr = row + dr; const nc = col + dc;
    if (inPalace(nr, nc)) moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}
function elephantMoves(board3, faction, row, col) {
  const moves = [];
  const steps = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
  const eyes = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (let i = 0; i < steps.length; i++) {
    const nr = row + steps[i][0]; const nc = col + steps[i][1];
    if (!inGrid(nr, nc)) continue;
    if (hasPiece(board3, keyOf(faction, row + eyes[i][0], col + eyes[i][1]))) continue;
    moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}
function horseMoves(board3, faction, row, col) {
  const moves = [];
  const steps = [
    { leg: [0, -1], dest: [-1, -2] }, { leg: [0, -1], dest: [1, -2] },
    { leg: [0, 1], dest: [-1, 2] }, { leg: [0, 1], dest: [1, 2] },
    { leg: [-1, 0], dest: [-2, -1] }, { leg: [-1, 0], dest: [-2, 1] },
    { leg: [1, 0], dest: [2, -1] }, { leg: [1, 0], dest: [2, 1] },
  ];
  for (const { leg, dest } of steps) {
    const lr = row + leg[1]; const lc = col + leg[0];
    const dr = row + dest[1]; const dc = col + dest[0];
    if (!inGrid(dr, dc)) continue;
    if (hasPiece(board3, keyOf(faction, lr, lc))) continue;
    moves.push({ key: keyOf(faction, dr, dc) });
  }
  return moves;
}

function rayCells(board3, startKey, dr, dc, targetFaction) {
  const cells = [];
  const start = parseKey(startKey);
  if (start.center) return cells;
  let cf = start.faction; let cr = start.row; let cc = start.col;
  let curDr = dr; let curDc = dc; let visitedCenter = false;
  while (true) {
    const nr = cr + curDr; const nc = cc + curDc;
    if (inGrid(nr, nc)) {
      cells.push({ key: keyOf(cf, nr, nc) }); cr = nr; cc = nc; continue;
    }
    if (curDr === 1 && curDc === 0 && cr === 5 && cc === 4 && !visitedCenter && targetFaction && targetFaction !== cf) {
      cells.push({ key: 'center' }); visitedCenter = true;
      cells.push({ key: keyOf(targetFaction, 5, 4) });
      cf = targetFaction; cr = 5; cc = 4; curDr = -1; curDc = 0; continue;
    }
    break;
  }
  return cells;
}

function dedupe(moves) {
  const u = new Set(); const out = [];
  for (const m of moves) { if (!u.has(m.key)) { u.add(m.key); out.push(m); } }
  return out;
}

function chariotMoves(board3, startKey) {
  const moves = [];
  const start = parseKey(startKey);
  const originFaction = start.faction;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const cells = rayCells(board3, startKey, dr, dc);
    for (const c of cells) {
      moves.push({ key: c.key });
      if (hasPiece(board3, c.key)) break;
    }
  }
  for (const target of THREE_FACTIONS) {
    if (target === originFaction) continue;
    const cells = rayCells(board3, startKey, 1, 0, target);
    for (const c of cells) {
      moves.push({ key: c.key });
      if (hasPiece(board3, c.key)) break;
    }
  }
  return dedupe(moves);
}

function cannonMoves(board3, startKey) {
  const moves = [];
  const start = parseKey(startKey);
  const originFaction = start.faction;
  const rays = [[-1, 0, null], [0, -1, null], [0, 1, null], [1, 0, null]];
  for (const target of THREE_FACTIONS) {
    if (target === originFaction) continue;
    rays.push([1, 0, target]);
  }
  for (const [dr, dc, target] of rays) {
    const cells = rayCells(board3, startKey, dr, dc, target);
    let jumped = false;
    for (const c of cells) {
      if (!jumped) {
        if (hasPiece(board3, c.key)) jumped = true;
        else moves.push({ key: c.key });
      } else if (hasPiece(board3, c.key)) {
        moves.push({ key: c.key }); break;
      }
    }
  }
  return dedupe(moves);
}

function pawnMoves(board3, startKey, piece) {
  const moves = [];
  const start = parseKey(startKey);
  if (start.center) {
    for (const f of THREE_FACTIONS) moves.push({ key: keyOf(f, 5, 4) });
    return moves;
  }
  const { faction, row, col } = start;
  const crossed = Boolean(piece && piece.crossedCenter);
  if (!crossed) {
    const nr = row + 1;
    if (inGrid(nr, col)) moves.push({ key: keyOf(faction, nr, col) });
    if (row === 5 && col === 4) moves.push({ key: 'center' });
  } else {
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr; const nc = col + dc;
      if (inGrid(nr, nc)) moves.push({ key: keyOf(faction, nr, nc) });
    }
    if (row === 5 && col === 4) moves.push({ key: 'center' });
  }
  return moves;
}

function movesFromCenter(board3) {
  const moves = [];
  for (const f of THREE_FACTIONS) moves.push({ key: keyOf(f, 5, 4) });
  return moves;
}

export function getThreeValidMoves(board3, key, moverFaction) {
  const cell = board3.get(key);
  if (!cell || !cell.piece) return [];
  if (cell.owner !== moverFaction) return [];
  if (key === 'center') return movesFromCenter(board3);
  switch (cell.piece) {
    case 'general': { const { faction, row, col } = parseKey(key); return generalMoves(board3, faction, row, col); }
    case 'advisor': { const { faction, row, col } = parseKey(key); return advisorMoves(board3, faction, row, col); }
    case 'elephant': { const { faction, row, col } = parseKey(key); return elephantMoves(board3, faction, row, col); }
    case 'horse': { const { faction, row, col } = parseKey(key); return horseMoves(board3, faction, row, col); }
    case 'chariot': return chariotMoves(board3, key);
    case 'cannon': return cannonMoves(board3, key);
    case 'pawn': return pawnMoves(board3, key, cell);
    default: return [];
  }
}

export function canCapture(board3, targetKey, moverFaction) {
  const t = board3.get(targetKey);
  if (!t || !t.piece) return false;
  return t.faction !== moverFaction;
}
