import {
  COLS,
  ROWS,
  TRADITIONAL,
  inPalace,
  inTerritory,
  crossedRiver,
  opponentColor,
} from './constants.js';

const tradMap = new Map();
for (const t of TRADITIONAL) {
  tradMap.set(`${t.row},${t.col}`, t.type);
}

const DARK_RANK = {
  general: 7,
  advisor: 6,
  elephant: 5,
  chariot: 4,
  horse: 3,
  cannon: 2,
  pawn: 1,
};

export function findTraditionalType(row, col) {
  return tradMap.get(`${row},${col}`) || null;
}

export function getChaosValidMoves(board, row, col) {
  const cell = board[row]?.[col];
  if (!cell || !cell.piece) return [];

  if (cell.hidden) {
    const tradType = findTraditionalType(row, col);
    return tradType ? rawMovesByType(board, row, col, tradType, cell.owner) : [];
  }
  return rawMovesByType(board, row, col, cell.piece, cell.color, { freeRoyal: true, freeElephant: true });
}

function rawMovesByType(board, row, col, type, color, options = {}) {
  switch (type) {
    case 'general': return generalMoves(board, row, col, color, options.freeRoyal);
    case 'advisor': return advisorMoves(board, row, col, color, options.freeRoyal);
    case 'elephant': return elephantMoves(board, row, col, color, options.freeElephant);
    case 'horse': return horseMoves(board, row, col);
    case 'chariot': return chariotMoves(board, row, col);
    case 'cannon': return cannonMoves(board, row, col);
    case 'pawn': return pawnMoves(board, row, col, color);
    default: return [];
  }
}

function generalMoves(board, row, col, color, freeRoyal = false) {
  const moves = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (!freeRoyal && !inPalace(nr, nc, color)) continue;
    moves.push({ row: nr, col: nc });
  }

  const oppCol = opponentColor(color);
  for (let r = 0; r < ROWS; r++) {
    const target = board[r][col];
    if (!target || target.piece !== 'general' || target.color !== oppCol) continue;
    let blocked = false;
    const minR = Math.min(row, r) + 1;
    const maxR = Math.max(row, r);
    for (let mr = minR; mr < maxR; mr++) {
      if (board[mr][col]?.piece) {
        blocked = true;
        break;
      }
    }
    if (!blocked) moves.push({ row: r, col });
  }
  return moves;
}

function advisorMoves(board, row, col, color, freeRoyal = false) {
  const moves = [];
  const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (!freeRoyal && !inPalace(nr, nc, color)) continue;
    moves.push({ row: nr, col: nc });
  }
  return moves;
}

function elephantMoves(board, row, col, color, freeElephant = false) {
  const moves = [];
  const dirs = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
  const eyes = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let i = 0; i < dirs.length; i++) {
    const nr = row + dirs[i][0];
    const nc = col + dirs[i][1];
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (!freeElephant && !inTerritory(nr, color)) continue;
    if (board[row + eyes[i][0]][col + eyes[i][1]]?.piece) continue;
    moves.push({ row: nr, col: nc });
  }
  return moves;
}

function horseMoves(board, row, col) {
  const moves = [];
  const steps = [
    { leg: [0, -1], dest: [-1, -2] }, { leg: [0, -1], dest: [1, -2] },
    { leg: [0, 1], dest: [-1, 2] }, { leg: [0, 1], dest: [1, 2] },
    { leg: [-1, 0], dest: [-2, -1] }, { leg: [-1, 0], dest: [-2, 1] },
    { leg: [1, 0], dest: [2, -1] }, { leg: [1, 0], dest: [2, 1] },
  ];
  for (const { leg, dest } of steps) {
    const lr = row + leg[1];
    const lc = col + leg[0];
    const dr = row + dest[1];
    const dc = col + dest[0];
    if (dr < 0 || dr >= ROWS || dc < 0 || dc >= COLS) continue;
    if (board[lr][lc]?.piece) continue;
    moves.push({ row: dr, col: dc });
  }
  return moves;
}

function chariotMoves(board, row, col) {
  return lineMoves(board, row, col, false);
}

function cannonMoves(board, row, col) {
  return lineMoves(board, row, col, true);
}

function lineMoves(board, row, col, isCannon) {
  const moves = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    let nr = row + dr;
    let nc = col + dc;
    let jumped = false;
    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
      const target = board[nr][nc];
      if (!isCannon) {
        if (target?.piece) {
          moves.push({ row: nr, col: nc });
          break;
        }
        moves.push({ row: nr, col: nc });
      } else if (!jumped) {
        if (target?.piece) {
          jumped = true;
        } else {
          moves.push({ row: nr, col: nc });
        }
      } else if (target?.piece) {
        moves.push({ row: nr, col: nc });
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

function pawnMoves(board, row, col, color) {
  const moves = [];
  const forward = color === 'red' ? -1 : 1;
  const fr = row + forward;
  if (fr >= 0 && fr < ROWS) {
    moves.push({ row: fr, col });
  }
  if (crossedRiver(row, color)) {
    for (const dc of [-1, 1]) {
      const nc = col + dc;
      if (nc >= 0 && nc < COLS) {
        moves.push({ row, col: nc });
      }
    }
  }
  return moves;
}

export function canDarkCapture(attacker, target) {
  if (!target) return false;
  if (target.hidden) return true;
  if (attacker.color === target.color) return false;
  if (attacker.piece === 'cannon') return true;
  if (attacker.piece === 'pawn') return target.piece === 'general' || target.piece === 'pawn';
  if (attacker.piece === 'general' && target.piece === 'pawn') return false;
  return DARK_RANK[attacker.piece] >= DARK_RANK[target.piece];
}

export function getDarkValidMoves(board, row, col) {
  const cell = board[row]?.[col];
  if (!cell || cell.hidden) return [];

  const moves = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const rowCount = board.length;
  const colCount = board[0]?.length || 0;

  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr >= rowCount || nc < 0 || nc >= colCount) continue;
    const target = board[nr][nc];
    if (!target) {
      moves.push({ row: nr, col: nc });
    } else if (cell.piece !== 'cannon' && canDarkCapture(cell, target)) {
      moves.push({ row: nr, col: nc });
    }
  }

  if (cell.piece !== 'cannon') return moves;

  for (const [dr, dc] of dirs) {
    let nr = row + dr;
    let nc = col + dc;
    let screens = 0;
    while (nr >= 0 && nr < rowCount && nc >= 0 && nc < colCount) {
      const target = board[nr][nc];
      if (target) {
        screens++;
        if (screens === 2) {
          if (canDarkCapture(cell, target)) moves.push({ row: nr, col: nc });
          break;
        }
      }
      nr += dr;
      nc += dc;
    }
  }

  return moves;
}
