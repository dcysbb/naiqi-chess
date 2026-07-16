// 三人模式走法。board3: Map<cellKey, piece>
// cellKey: "wei:3:4"（阵营:行:列） 或 "center"
// 每个棋子的局部坐标：row 0 = 后方，row 5 = 靠近中心；col 0..8。
// 中心格 "center" 与每个阵营的 (faction, 5, 4) 相邻。

const {
  ROWS, COLS, inPalace, inGrid, THREE_FACTIONS, nextFaction,
} = require('./constants');

function keyOf(faction, row, col) {
  return `${faction}:${row}:${col}`;
}
function isCenter(key) { return key === 'center'; }
function parseKey(key) {
  if (key === 'center') return { center: true };
  const [faction, row, col] = key.split(':');
  return { faction, row: Number(row), col: Number(col) };
}

function hasPiece(board3, key) {
  const c = board3.get(key);
  return !!c && !!c.piece;
}

// --- 九宫内一格移动（将/士） ---
// 注意：将在九宫内移动，但将可能因过中心而在他阵九宫？不——将不过中心（只能在九宫）。
function generalMoves(board3, faction, row, col) {
  const moves = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (!inPalace(nr, nc)) continue;
    moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}

function advisorMoves(board3, faction, row, col) {
  const moves = [];
  const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (!inPalace(nr, nc)) continue;
    moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}

// --- 象：田字两格，蹩腿，不限区域（取消不过河） ---
function elephantMoves(board3, faction, row, col) {
  const moves = [];
  const steps = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
  const eyes = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (let i = 0; i < steps.length; i++) {
    const nr = row + steps[i][0];
    const nc = col + steps[i][1];
    if (!inGrid(nr, nc)) continue;
    const er = row + eyes[i][0];
    const ec = col + eyes[i][1];
    if (hasPiece(board3, keyOf(faction, er, ec))) continue;
    moves.push({ key: keyOf(faction, nr, nc) });
  }
  return moves;
}

// --- 马：日字，蹩马腿 ---
function horseMoves(board3, faction, row, col) {
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
    if (!inGrid(dr, dc)) continue;
    if (hasPiece(board3, keyOf(faction, lr, lc))) continue;
    moves.push({ key: keyOf(faction, dr, dc) });
  }
  return moves;
}

// --- 车/炮：沿线扫描，可穿过中心进入其他阵营 ---
//
// 中心是对称中转节点：车/炮到达 (faction,5,4) 朝中心方向时进入 center，
// 然后可向"另外两个阵营"分别延伸（对称，无单向优势）。
// 实现：rayCells 只扫描单条直线（含穿 center 后到下一个阵营），
// 对称性通过为每个起点生成"穿过 center 到每个其它阵营"的额外方向保证。
//
// 局部方向 dr/dc：
//   dr=+1 朝中心(row 增大)；dr=-1 朝本阵后方(row 减小)
//   dc=±1 横向

function rayCells(board3, startKey, dr, dc, targetFaction) {
  // targetFaction: 射线最终要进入的目标阵营（用于穿 center 时选择）。
  // 不传则只在本阵内扫描。
  const cells = [];
  const start = parseKey(startKey);
  if (start.center) return cells;

  let cf = start.faction;
  let cr = start.row;
  let cc = start.col;
  let curDr = dr;
  let curDc = dc;
  let visitedCenter = false;

  while (true) {
    const nr = cr + curDr;
    const nc = cc + curDc;
    if (inGrid(nr, nc)) {
      cells.push({ key: keyOf(cf, nr, nc) });
      cr = nr; cc = nc;
      continue;
    }
    // 出本阵边界：仅在 (5,4) 朝中心(dr=+1)时可穿 center，进入指定 targetFaction
    if (curDr === 1 && curDc === 0 && cr === 5 && cc === 4 && !visitedCenter && targetFaction && targetFaction !== cf) {
      cells.push({ key: 'center' });
      visitedCenter = true;
      cells.push({ key: keyOf(targetFaction, 5, 4) });
      cf = targetFaction; cr = 5; cc = 4; curDr = -1; curDc = 0;
      continue;
    }
    break;
  }
  return cells;
}

// 车：本阵 4 方向扫描 + 经 center 到另外两阵营的对称扫描。
function chariotMoves(board3, startKey) {
  const moves = [];
  const seen = new Set();
  function add(key) {
    if (!seen.has(key)) { seen.add(key); moves.push({ key }); }
    // 扫描遇第一颗子即停（在下面循环里处理 break）
  }
  const start = parseKey(startKey);
  const originFaction = start.faction;

  // 本阵内 4 方向
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const cells = rayCells(board3, startKey, dr, dc);
    for (const c of cells) {
      moves.push({ key: c.key });
      if (hasPiece(board3, c.key)) break;
    }
  }
  // 经 center 到另外两阵营（对称）：从 (origin,5,4) 朝中心，目标为每个其它阵营
  for (const target of THREE_FACTIONS) {
    if (target === originFaction) continue;
    const cells = rayCells(board3, startKey, 1, 0, target);
    for (const c of cells) {
      moves.push({ key: c.key });
      if (hasPiece(board3, c.key)) break;
    }
  }
  // 去重
  const unique = [];
  const u = new Set();
  for (const m of moves) {
    if (!u.has(m.key)) { u.add(m.key); unique.push(m); }
  }
  return unique;
}

// 炮：同方向扫描，跳第一颗子（炮架），落第二颗子上（可吃）。
function cannonMoves(board3, startKey) {
  const moves = [];
  const start = parseKey(startKey);
  const originFaction = start.faction;
  const rays = [
    [-1, 0, null], [0, -1, null], [0, 1, null],
    [1, 0, null], // 本阵朝中心方向（若不到 center 也算）
  ];
  for (const target of THREE_FACTIONS) {
    if (target === originFaction) continue;
    rays.push([1, 0, target]); // 穿 center 到该阵营
  }

  for (const [dr, dc, target] of rays) {
    const cells = rayCells(board3, startKey, dr, dc, target);
    let jumped = false;
    for (const c of cells) {
      if (!jumped) {
        if (hasPiece(board3, c.key)) jumped = true;
        else moves.push({ key: c.key });
      } else if (hasPiece(board3, c.key)) {
        moves.push({ key: c.key });
        break;
      }
    }
  }
  // 去重
  const unique = [];
  const u = new Set();
  for (const m of moves) {
    if (!u.has(m.key)) { u.add(m.key); unique.push(m); }
  }
  return unique;
}

// --- 兵：朝中心方向(+row)一格；过中心后可横走 ---
// "已过中心"只看 crossedCenter 标志，不再按 row>=5 推断（避免提前横走/后退）。
function pawnMoves(board3, startKey, piece) {
  const moves = [];
  const start = parseKey(startKey);
  if (start.center) {
    // 兵在 center：可去任一 (5,4)
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
      const nr = row + dr;
      const nc = col + dc;
      if (inGrid(nr, nc)) moves.push({ key: keyOf(faction, nr, nc) });
    }
    if (row === 5 && col === 4) moves.push({ key: 'center' });
  }
  return moves;
}

// 在 center 格上的走法：可到三个阵营的 (5,4)。
function movesFromCenter(board3) {
  const moves = [];
  for (const f of THREE_FACTIONS) moves.push({ key: keyOf(f, 5, 4) });
  return moves;
}

// --- 统一入口 ---
// moverFaction：走棋方的阵营（用于判断能否吃子）；cellKey 决定棋子物理位置。
function getThreeValidMoves(board3, key, moverFaction) {
  const cell = board3.get(key);
  if (!cell || !cell.piece) return [];
  if (cell.owner !== moverFaction) return [];

  if (key === 'center') {
    // 车炮兵在 center：车炮需沿线，但简化为可去 (5,4)；兵去 (5,4)
    return movesFromCenter(board3);
  }

  switch (cell.piece) {
    case 'general': {
      const { faction, row, col } = parseKey(key);
      return generalMoves(board3, faction, row, col);
    }
    case 'advisor': {
      const { faction, row, col } = parseKey(key);
      return advisorMoves(board3, faction, row, col);
    }
    case 'elephant': {
      const { faction, row, col } = parseKey(key);
      return elephantMoves(board3, faction, row, col);
    }
    case 'horse': {
      const { faction, row, col } = parseKey(key);
      return horseMoves(board3, faction, row, col);
    }
    case 'chariot':
      return chariotMoves(board3, key);
    case 'cannon':
      return cannonMoves(board3, key);
    case 'pawn':
      return pawnMoves(board3, key, cell);
    default:
      return [];
  }
}

module.exports = {
  keyOf,
  parseKey,
  isCenter,
  getThreeValidMoves,
  canCapture: (board3, targetKey, moverFaction) => {
    const t = board3.get(targetKey);
    if (!t || !t.piece) return false;
    return t.faction !== moverFaction;
  },
  movesFromCenter,
};
