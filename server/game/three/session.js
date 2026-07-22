// 三人模式对局会话。board 用 Map<cellKey, piece>，cellKey 形如 "wei:3:4" 或 "center"。

const {
  THREE_FACTIONS, TURN_ORDER, THREE_LAYOUT, THREE_PIECE_CHARS,
  FACTION_LABELS, ROWS, COLS, nextActiveFaction,
} = require('./constants');
const { keyOf, parseKey, getThreeValidMoves, canCapture } = require('./moves');

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class ThreeGameSession {
  constructor(roomId, mode = 'three-open') {
    this.roomId = roomId;
    // 'three-open'（明棋）或 'three-dark'（暗棋翻面）
    this.mode = mode === 'three-dark' ? 'three-dark' : 'three-open';
    this.isDark = this.mode === 'three-dark';
    this.board = new Map(); // cellKey -> {piece, faction, hidden, crossedRiver, owner}
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
    // 明棋：visible，标准布局；暗棋：hidden，每个阵营内部棋种随机洗牌
    // （阵营归属不变，但棋种与位置不再对应，熟悉象棋也无法直接推断身份）。
    for (const faction of THREE_FACTIONS) {
      // 该阵营的标准 16 子棋种列表
      const pieces = THREE_LAYOUT
        .filter((p) => p.faction === faction)
        .map((p) => p.type);
      const arranged = this.isDark ? shuffleArray(pieces) : pieces;
      THREE_LAYOUT
        .filter((p) => p.faction === faction)
        .forEach((p, i) => {
          this.board.set(keyOf(faction, p.row, p.col), {
            piece: arranged[i],
            faction,
            hidden: this.isDark,
            crossedRiver: false,
            owner: faction, // 暗棋时翻开前 owner 即所在阵营
          });
        });
    }
    // 中心格初始无棋子
  }

  get factions() { return THREE_FACTIONS; }

  addPlayer(socketId, faction) {
    this.players[faction] = socketId;
    if (THREE_FACTIONS.every((f) => this.players[f])) {
      this.status = 'playing';
    }
  }

  removePlayer(socketId) {
    const wasPlaying = this.status === 'playing';
    for (const f of THREE_FACTIONS) {
      if (this.players[f] === socketId) {
        this.players[f] = null;
        // 仅在对局进行中离席才执行淘汰（移除棋子）；等待阶段只释放座位。
        if (wasPlaying && !this.eliminated.has(f)) this.eliminate(f);
      }
    }
    // 若剩余非淘汰阵营 <=1，则结束
    const remaining = THREE_FACTIONS.filter((f) => !this.eliminated.has(f));
    if (remaining.length <= 1 && this.status !== 'waiting') {
      this.status = 'finished';
      this.winner = remaining[0] || null;
      this.resultReason = 'opponent_disconnected';
    }
  }

  isJoinable() {
    // 仅等待中的房间可被加入；已开局/已结束都不开放（避免进入残局）。
    return this.status === 'waiting'
      && !THREE_FACTIONS.every((f) => this.players[f]);
  }

  // 玩家查询某棋子的合法走法（返回 cellKey 列表 + 是否吃子）。
  getValidMovesForPlayer(key, faction) {
    const cell = this.board.get(key);
    if (!cell || !cell.piece) return [];
    // 明棋：cell.owner === faction；暗棋：未翻开的暗子 owner === faction（可走），
    //   已翻开的 owner === faction 才可走。
    if (cell.owner !== faction) return [];
    if (this.isDark && cell.hidden) return []; // 暗棋未翻不可走
    const raw = getThreeValidMoves(this.board, key, faction);
    // 过滤掉同阵营（不可吃自己人）
    return raw.filter((m) => {
      const t = this.board.get(m.key);
      if (!t || !t.piece) return true; // 空格可走
      return t.faction !== faction; // 对方/已淘汰阵营棋子可吃
    }).map((m) => ({
      key: m.key,
      isCapture: Boolean(this.board.get(m.key)?.piece),
    }));
  }

  // 暗棋：翻面（只能翻本方阵营的暗子）
  flipPiece(key, faction) {
    if (!this.isDark) return { ok: false, error: '明棋模式不可翻面' };
    if (this.status !== 'playing') return { ok: false, error: 'game not in progress' };
    if (this.currentTurn !== faction) return { ok: false, error: 'not your turn' };
    const cell = this.board.get(key);
    if (!cell || !cell.hidden) return { ok: false, error: 'no hidden piece there' };
    // 只能翻本方暗子（owner 即所在阵营，翻开前不变）
    if (cell.owner !== faction) return { ok: false, error: 'can only flip your own pieces' };
    cell.hidden = false;
    cell.owner = cell.faction; // 翻开后归其真实阵营
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
    if (!valid.some((m) => m.key === toKey)) {
      return { ok: false, error: 'invalid move' };
    }

    const target = this.board.get(toKey);
    const captured = target && target.piece
      ? { piece: target.piece, faction: target.faction, key: toKey }
      : null;

    // 暗棋：移动后翻开（如果是从暗子状态移动）。明棋无翻面。
    let revealed = null;
    if (this.isDark && fromCell.hidden) {
      fromCell.hidden = false;
      fromCell.owner = fromCell.faction;
      revealed = { piece: fromCell.piece, faction: fromCell.faction };
    }

    // 移动：从 fromKey 删除，放到 toKey
    this.board.delete(fromKey);
    const toInfo = parseKey(toKey);
    const crossed = toInfo.faction !== faction;
    const movedPiece = {
      ...fromCell,
      crossedRiver: fromCell.crossedRiver || crossed,
    };
    this.board.set(toKey, movedPiece);

    // 若吃将 → 该方淘汰
    let gameOver = false;
    let winner = null;
    let reason = '';
    if (captured && captured.piece === 'general') {
      this.eliminate(captured.faction);
      const remaining = THREE_FACTIONS.filter((f) => !this.eliminated.has(f));
      if (remaining.length <= 1) {
        gameOver = true;
        winner = remaining[0] || null;
        reason = 'last_standing';
        this.status = 'finished';
        this.winner = winner;
        this.resultReason = reason;
      }
    }

    if (!gameOver) {
      this.currentTurn = nextActiveFaction(faction, this.eliminated);
    }

    const move = {
      type: 'move',
      fromKey, toKey,
      piece: movedPiece.piece,
      faction: movedPiece.faction,
      revealed,
      captured,
      gameOver, winner, reason,
    };
    this.moveHistory.push(move);
    return { ok: true, move, currentTurn: this.currentTurn, gameOver, winner, reason };
  }

  // 淘汰某阵营：移除其全部棋子。
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

  // 给某阵营的公开状态。
  getPublicState(forFaction) {
    // 棋子可见性：明棋全部可见；暗棋未翻开的只暴露 {hidden, owner, faction位置?}
    // 为不泄露暗子真实身份，未翻开的棋子不返回 piece/faction。
    const cells = [];
    for (const [key, cell] of this.board.entries()) {
      const info = { key, hidden: cell.hidden, owner: cell.owner, crossedRiver: cell.crossedRiver };
      if (!cell.hidden) {
        info.piece = cell.piece;
        info.faction = cell.faction;
      }
      cells.push(info);
    }
    return {
      mode: this.mode,
      isThree: true,
      boardSchema: 'three-135-v1',
      rows: ROWS,
      cols: COLS,
      cells,
      currentTurn: this.currentTurn,
      status: this.status,
      winner: this.winner,
      resultReason: this.resultReason,
      eliminated: Array.from(this.eliminated),
      yourFaction: forFaction,
      moveHistory: this.moveHistory,
      players: THREE_FACTIONS.reduce((acc, f) => {
        acc[f] = this.players[f] ? 'connected' : 'waiting';
        return acc;
      }, {}),
      rematch: THREE_FACTIONS.reduce((acc, f) => {
        acc[f] = Boolean(this.rematchRequests[f]);
        return acc;
      }, {}),
    };
  }

  getStatus() {
    return {
      status: this.status,
      currentTurn: this.currentTurn,
      winner: this.winner,
      eliminated: Array.from(this.eliminated),
      isCheck: false,
    };
  }
}

module.exports = { ThreeGameSession };
