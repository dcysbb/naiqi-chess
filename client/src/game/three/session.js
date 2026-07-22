// 三人模式对局会话 —— 客户端 ESM 版（与服务端逻辑一致）。
import {
  THREE_FACTIONS, THREE_LAYOUT, ROWS, COLS, nextActiveFaction,
} from './constants.js';
import { keyOf, parseKey, getThreeValidMoves } from './moves.js';

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class ThreeGameSession {
  constructor(roomId, mode = 'three-open') {
    this.roomId = roomId;
    this.mode = mode === 'three-dark' ? 'three-dark' : 'three-open';
    this.isDark = this.mode === 'three-dark';
    this.board = new Map();
    this.currentTurn = 'wei';
    this.players = { wei: null, shu: null, wu: null };
    this.eliminated = new Set();
    this.status = 'waiting';
    this.winner = null;
    this.resultReason = '';
    this.rematchRequests = { wei: false, shu: false, wu: false };
    this.moveHistory = [];
    this.initBoard();
  }

  initBoard() {
    this.board = new Map();
    for (const faction of THREE_FACTIONS) {
      const pieces = THREE_LAYOUT.filter((p) => p.faction === faction).map((p) => p.type);
      const arranged = this.isDark ? shuffleArray(pieces) : pieces;
      THREE_LAYOUT
        .filter((p) => p.faction === faction)
        .forEach((p, i) => {
          this.board.set(keyOf(faction, p.row, p.col), {
            piece: arranged[i], faction,
            hidden: this.isDark, crossedRiver: false, owner: faction,
          });
        });
    }
  }

  get factions() { return THREE_FACTIONS; }

  addPlayer(id, faction) {
    this.players[faction] = id;
    if (THREE_FACTIONS.every((f) => this.players[f])) this.status = 'playing';
  }

  removePlayer(id) {
    const wasPlaying = this.status === 'playing';
    for (const f of THREE_FACTIONS) {
      if (this.players[f] === id) {
        this.players[f] = null;
        if (wasPlaying && !this.eliminated.has(f)) this.eliminate(f);
      }
    }
    const remaining = THREE_FACTIONS.filter((f) => !this.eliminated.has(f));
    if (remaining.length <= 1 && this.status !== 'waiting') {
      this.status = 'finished';
      this.winner = remaining[0] || null;
      this.resultReason = 'opponent_disconnected';
    }
  }

  isJoinable() {
    return this.status === 'waiting' && !THREE_FACTIONS.every((f) => this.players[f]);
  }

  getValidMovesForPlayer(key, faction) {
    const cell = this.board.get(key);
    if (!cell || !cell.piece) return [];
    if (cell.owner !== faction) return [];
    if (this.isDark && cell.hidden) return [];
    return getThreeValidMoves(this.board, key, faction).filter((m) => {
      const t = this.board.get(m.key);
      if (!t || !t.piece) return true;
      return t.faction !== faction;
    }).map((m) => ({ key: m.key, isCapture: Boolean(this.board.get(m.key)?.piece) }));
  }

  flipPiece(key, faction) {
    if (!this.isDark) return { ok: false, error: '明棋模式不可翻面' };
    if (this.status !== 'playing') return { ok: false, error: 'game not in progress' };
    if (this.currentTurn !== faction) return { ok: false, error: 'not your turn' };
    const cell = this.board.get(key);
    if (!cell || !cell.hidden) return { ok: false, error: 'no hidden piece there' };
    if (cell.owner !== faction) return { ok: false, error: 'can only flip your own pieces' };
    cell.hidden = false;
    cell.owner = cell.faction;
    this.currentTurn = nextActiveFaction(faction, this.eliminated);
    const move = { type: 'flip', key, piece: cell.piece, faction: cell.faction };
    this.moveHistory.push(move);
    return { ok: true, move, currentTurn: this.currentTurn, gameOver: false };
  }

  tryMove(fromKey, toKey, faction) {
    if (this.status !== 'playing') return { ok: false, error: 'game not in progress' };
    if (this.currentTurn !== faction) return { ok: false, error: 'not your turn' };
    const fromCell = this.board.get(fromKey);
    if (!fromCell || !fromCell.piece) return { ok: false, error: 'no piece there' };
    if (fromCell.owner !== faction) return { ok: false, error: 'not your piece' };
    if (this.isDark && fromCell.hidden) return { ok: false, error: 'flip hidden pieces before moving' };

    const valid = this.getValidMovesForPlayer(fromKey, faction);
    if (!valid.some((m) => m.key === toKey)) return { ok: false, error: 'invalid move' };

    const target = this.board.get(toKey);
    const captured = target && target.piece
      ? { piece: target.piece, faction: target.faction, key: toKey } : null;

    let revealed = null;
    if (this.isDark && fromCell.hidden) {
      fromCell.hidden = false;
      fromCell.owner = fromCell.faction;
      revealed = { piece: fromCell.piece, faction: fromCell.faction };
    }

    this.board.delete(fromKey);
    const toInfo = parseKey(toKey);
    const crossed = toInfo.faction !== faction;
    const movedPiece = { ...fromCell, crossedRiver: fromCell.crossedRiver || crossed };
    this.board.set(toKey, movedPiece);

    let gameOver = false; let winner = null; let reason = '';
    if (captured && captured.piece === 'general') {
      this.eliminate(captured.faction);
      const remaining = THREE_FACTIONS.filter((f) => !this.eliminated.has(f));
      if (remaining.length <= 1) {
        gameOver = true; winner = remaining[0] || null; reason = 'last_standing';
        this.status = 'finished'; this.winner = winner; this.resultReason = reason;
      }
    }
    if (!gameOver) this.currentTurn = nextActiveFaction(faction, this.eliminated);

    const move = {
      type: 'move', fromKey, toKey,
      piece: movedPiece.piece, faction: movedPiece.faction,
      revealed, captured, gameOver, winner, reason,
    };
    this.moveHistory.push(move);
    return { ok: true, move, currentTurn: this.currentTurn, gameOver, winner, reason };
  }

  eliminate(faction) {
    this.eliminated.add(faction);
    for (const [key, cell] of this.board.entries()) {
      if (cell.faction === faction) this.board.delete(key);
    }
  }

  requestRematch(faction) {
    if (this.status !== 'finished') return { ok: false, error: 'game not finished' };
    if (!this.players[faction]) return { ok: false, error: 'not in this game' };
    this.rematchRequests[faction] = true;
    const allReady = THREE_FACTIONS.every((f) => this.rematchRequests[f]);
    return { ok: true, ready: allReady, who: faction };
  }

  resetForRematch() {
    this.board = new Map();
    this.currentTurn = 'wei';
    this.eliminated = new Set();
    this.status = THREE_FACTIONS.every((f) => this.players[f]) ? 'playing' : 'waiting';
    this.winner = null;
    this.resultReason = '';
    this.rematchRequests = { wei: false, shu: false, wu: false };
    this.moveHistory = [];
    this.initBoard();
  }

  getPublicState(forFaction) {
    const cells = [];
    for (const [key, cell] of this.board.entries()) {
      const info = { key, hidden: cell.hidden, owner: cell.owner, crossedRiver: cell.crossedRiver };
      if (!cell.hidden) { info.piece = cell.piece; info.faction = cell.faction; }
      cells.push(info);
    }
    return {
      mode: this.mode, isThree: true, boardSchema: 'three-135-v1', rows: ROWS, cols: COLS, cells,
      currentTurn: this.currentTurn, status: this.status,
      winner: this.winner, resultReason: this.resultReason,
      eliminated: Array.from(this.eliminated), yourFaction: forFaction,
      moveHistory: this.moveHistory,
      players: THREE_FACTIONS.reduce((acc, f) => { acc[f] = this.players[f] ? 'connected' : 'waiting'; return acc; }, {}),
      rematch: THREE_FACTIONS.reduce((acc, f) => { acc[f] = Boolean(this.rematchRequests[f]); return acc; }, {}),
    };
  }

  getStatus() {
    return {
      status: this.status, currentTurn: this.currentTurn, winner: this.winner,
      eliminated: Array.from(this.eliminated), isCheck: false,
    };
  }
}
