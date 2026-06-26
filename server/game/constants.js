const COLS = 9;
const ROWS = 10;
const DARK_COLS = 8;
const DARK_ROWS = 4;

const PIECE_CHARS = {
  general: { red: '帅', black: '将' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  horse: { red: '傌', black: '馬' },
  chariot: { red: '俥', black: '車' },
  cannon: { red: '炮', black: '砲' },
  pawn: { red: '兵', black: '卒' },
};

const PIECE_TYPES = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'pawn'];

const TRADITIONAL = [
  { row: 0, col: 0, type: 'chariot', color: 'black' },
  { row: 0, col: 1, type: 'horse', color: 'black' },
  { row: 0, col: 2, type: 'elephant', color: 'black' },
  { row: 0, col: 3, type: 'advisor', color: 'black' },
  { row: 0, col: 4, type: 'general', color: 'black' },
  { row: 0, col: 5, type: 'advisor', color: 'black' },
  { row: 0, col: 6, type: 'elephant', color: 'black' },
  { row: 0, col: 7, type: 'horse', color: 'black' },
  { row: 0, col: 8, type: 'chariot', color: 'black' },
  { row: 2, col: 1, type: 'cannon', color: 'black' },
  { row: 2, col: 7, type: 'cannon', color: 'black' },
  { row: 3, col: 0, type: 'pawn', color: 'black' },
  { row: 3, col: 2, type: 'pawn', color: 'black' },
  { row: 3, col: 4, type: 'pawn', color: 'black' },
  { row: 3, col: 6, type: 'pawn', color: 'black' },
  { row: 3, col: 8, type: 'pawn', color: 'black' },
  { row: 6, col: 0, type: 'pawn', color: 'red' },
  { row: 6, col: 2, type: 'pawn', color: 'red' },
  { row: 6, col: 4, type: 'pawn', color: 'red' },
  { row: 6, col: 6, type: 'pawn', color: 'red' },
  { row: 6, col: 8, type: 'pawn', color: 'red' },
  { row: 7, col: 1, type: 'cannon', color: 'red' },
  { row: 7, col: 7, type: 'cannon', color: 'red' },
  { row: 9, col: 0, type: 'chariot', color: 'red' },
  { row: 9, col: 1, type: 'horse', color: 'red' },
  { row: 9, col: 2, type: 'elephant', color: 'red' },
  { row: 9, col: 3, type: 'advisor', color: 'red' },
  { row: 9, col: 4, type: 'general', color: 'red' },
  { row: 9, col: 5, type: 'advisor', color: 'red' },
  { row: 9, col: 6, type: 'elephant', color: 'red' },
  { row: 9, col: 7, type: 'horse', color: 'red' },
  { row: 9, col: 8, type: 'chariot', color: 'red' },
];

const PALACE = {
  red: { colMin: 3, colMax: 5, rowMin: 7, rowMax: 9 },
  black: { colMin: 3, colMax: 5, rowMin: 0, rowMax: 2 },
};

function createPieceSet() {
  return TRADITIONAL.map(({ type, color }) => ({ type, color }));
}

function inPalace(row, col, color) {
  const p = PALACE[color];
  return row >= p.rowMin && row <= p.rowMax && col >= p.colMin && col <= p.colMax;
}

function inTerritory(row, color) {
  return color === 'red' ? row >= 5 : row <= 4;
}

function crossedRiver(row, color) {
  return color === 'red' ? row <= 4 : row >= 5;
}

function opponentColor(color) {
  return color === 'red' ? 'black' : 'red';
}

module.exports = {
  COLS,
  ROWS,
  DARK_COLS,
  DARK_ROWS,
  PIECE_CHARS,
  PIECE_TYPES,
  TRADITIONAL,
  PALACE,
  createPieceSet,
  inPalace,
  inTerritory,
  crossedRiver,
  opponentColor,
};
