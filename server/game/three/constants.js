// 三人模式（魏蜀吴）常量与布局。
// 棋盘几何：三个 6 行 × 9 列的"半棋盘"以 120° 夹角围绕中心拼接。
// 局部坐标：localRow 0 = 本阵后方边缘（标 1..9），localRow 5 = 最靠近中心；
//           localCol 0..8 对应 9 条纵线。
// 九宫：localRow 0..2，localCol 3..5。
// 中心：一个共享格点 `center`，与每个阵营的 (faction, 5, 4) 相邻。

const THREE_FACTIONS = ['wei', 'shu', 'wu'];

// 回合顺序：魏→蜀→吴→魏（顺时针）。
const TURN_ORDER = ['wei', 'shu', 'wu'];

// 棋子文字。魏沿用红方字、蜀沿用黑方字、吴用第三套字（可区分）。
const THREE_PIECE_CHARS = {
  general: { wei: '帥', shu: '将', wu: '王' },
  advisor: { wei: '仕', shu: '士', wu: '士' },
  elephant: { wei: '相', shu: '象', wu: '象' },
  horse: { wei: '傌', shu: '馬', wu: '駒' },
  chariot: { wei: '俥', shu: '車', wu: '車' },
  cannon: { wei: '炮', shu: '砲', wu: '砲' },
  pawn: { wei: '兵', shu: '卒', wu: '卒' },
};

// 阵营显示色（与客户端渲染一致）。
const FACTION_COLORS = {
  wei: '#c0392b', // 红褐
  shu: '#2c3e50', // 黑
  wu: '#27ae60',  // 绿
};

const FACTION_LABELS = { wei: '魏', shu: '蜀', wu: '吴' };

// 每阵营的局部网格尺寸。
const ROWS = 6;
const COLS = 9;

// 九宫（局部坐标）。
const PALACE = { rowMin: 0, rowMax: 2, colMin: 3, colMax: 5 };

// 每阵营起始布子（局部坐标）。每阵营 16 子。
// 后方（row 0）：车马象士将士象马车
// row 2：炮在 col 1、7
// row 3：兵在 col 0,2,4,6,8
const BACK_RANK = [
  { col: 0, type: 'chariot' },
  { col: 1, type: 'horse' },
  { col: 2, type: 'elephant' },
  { col: 3, type: 'advisor' },
  { col: 4, type: 'general' },
  { col: 5, type: 'advisor' },
  { col: 6, type: 'elephant' },
  { col: 7, type: 'horse' },
  { col: 8, type: 'chariot' },
];
const CANNON_RANK = [
  { col: 1, type: 'cannon' },
  { col: 7, type: 'cannon' },
];
const PAWN_RANK = [
  { col: 0, type: 'pawn' },
  { col: 2, type: 'pawn' },
  { col: 4, type: 'pawn' },
  { col: 6, type: 'pawn' },
  { col: 8, type: 'pawn' },
];

// 生成每阵营的起始布子表：[{faction, row, col, type}]
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
  return row >= PALACE.rowMin && row <= PALACE.rowMax
    && col >= PALACE.colMin && col <= PALACE.colMax;
}

// 阵营局部坐标是否在网格内。
function inGrid(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

// 回合推进。
function nextFaction(faction) {
  const i = TURN_ORDER.indexOf(faction);
  return TURN_ORDER[(i + 1) % TURN_ORDER.length];
}

// 跳过已淘汰阵营，找到下一个仍有棋子的阵营。
function nextActiveFaction(faction, eliminated) {
  let cur = faction;
  for (let i = 0; i < TURN_ORDER.length; i++) {
    cur = nextFaction(cur);
    if (!eliminated.has(cur)) return cur;
  }
  return faction;
}

module.exports = {
  THREE_FACTIONS,
  TURN_ORDER,
  THREE_PIECE_CHARS,
  FACTION_COLORS,
  FACTION_LABELS,
  ROWS,
  COLS,
  PALACE,
  THREE_LAYOUT,
  inPalace,
  inGrid,
  nextFaction,
  nextActiveFaction,
};
