// 三人模式（魏蜀吴）常量与布局 —— 客户端 ESM 版（与服务端逻辑一致）。

const THREE_FACTIONS = ['wei', 'shu', 'wu'];
const TURN_ORDER = ['wei', 'shu', 'wu'];

const THREE_PIECE_CHARS = {
  general: { wei: '帥', shu: '将', wu: '王' },
  advisor: { wei: '仕', shu: '士', wu: '士' },
  elephant: { wei: '相', shu: '象', wu: '象' },
  horse: { wei: '傌', shu: '馬', wu: '駒' },
  chariot: { wei: '俥', shu: '車', wu: '車' },
  cannon: { wei: '炮', shu: '砲', wu: '砲' },
  pawn: { wei: '兵', shu: '卒', wu: '卒' },
};

const FACTION_COLORS = { wei: '#c0392b', shu: '#2c3e50', wu: '#27ae60' };
const FACTION_LABELS = { wei: '魏', shu: '蜀', wu: '吴' };

const ROWS = 5;
const COLS = 9;
const PALACE = { rowMin: 0, rowMax: 2, colMin: 3, colMax: 5 };

const BACK_RANK = [
  { col: 0, type: 'chariot' }, { col: 1, type: 'horse' }, { col: 2, type: 'elephant' },
  { col: 3, type: 'advisor' }, { col: 4, type: 'general' }, { col: 5, type: 'advisor' },
  { col: 6, type: 'elephant' }, { col: 7, type: 'horse' }, { col: 8, type: 'chariot' },
];
const CANNON_RANK = [{ col: 1, type: 'cannon' }, { col: 7, type: 'cannon' }];
const PAWN_RANK = [
  { col: 0, type: 'pawn' }, { col: 2, type: 'pawn' }, { col: 4, type: 'pawn' },
  { col: 6, type: 'pawn' }, { col: 8, type: 'pawn' },
];

function buildThreeLayout() {
  const out = [];
  for (const faction of THREE_FACTIONS) {
    for (const { col, type } of BACK_RANK) out.push({ faction, row: 0, col, type });
    for (const { col, type } of CANNON_RANK) out.push({ faction, row: 2, col, type });
    for (const { col, type } of PAWN_RANK) out.push({ faction, row: 3, col, type });
  }
  return out;
}

const THREE_LAYOUT = buildThreeLayout();

function inPalace(row, col) {
  return row >= PALACE.rowMin && row <= PALACE.rowMax && col >= PALACE.colMin && col <= PALACE.colMax;
}
function inGrid(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}
function nextFaction(faction) {
  const i = TURN_ORDER.indexOf(faction);
  return TURN_ORDER[(i + 1) % TURN_ORDER.length];
}
function nextActiveFaction(faction, eliminated) {
  let cur = faction;
  for (let i = 0; i < TURN_ORDER.length; i++) {
    cur = nextFaction(cur);
    if (!eliminated.has(cur)) return cur;
  }
  return faction;
}

export {
  THREE_FACTIONS, TURN_ORDER, THREE_PIECE_CHARS, FACTION_COLORS, FACTION_LABELS,
  ROWS, COLS, PALACE, THREE_LAYOUT,
  inPalace, inGrid, nextFaction, nextActiveFaction,
};
