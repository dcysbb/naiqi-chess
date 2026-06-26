const {
  COLS,
  ROWS,
  DARK_COLS,
  DARK_ROWS,
  TRADITIONAL,
  createPieceSet,
  opponentColor,
} = require('./constants');
const { getChaosValidMoves, getDarkValidMoves } = require('./moves');

function createEmptyBoard(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function captureInfo(cell, row, col) {
  return cell
    ? { piece: cell.piece, color: cell.color, row, col, wasHidden: cell.hidden }
    : null;
}

class GameSession {
  constructor(roomId, mode = 'chaos') {
    this.roomId = roomId;
    this.mode = mode === 'dark' ? 'dark' : 'chaos';
    this.rows = this.mode === 'dark' ? DARK_ROWS : ROWS;
    this.cols = this.mode === 'dark' ? DARK_COLS : COLS;
    this.board = null;
    this.currentTurn = 'red';
    this.moveHistory = [];
    this.players = { red: null, black: null };
    this.status = 'waiting';
    this.winner = null;
    this.resultReason = '';
    this.rematchRequests = { red: false, black: false };
    this.initBoard();
  }

  initBoard() {
    if (this.mode === 'dark') {
      this.initDarkBoard();
    } else {
      this.initChaosBoard();
    }
  }

  initChaosBoard() {
    const shuffled = shuffleArray(createPieceSet());
    this.board = createEmptyBoard(ROWS, COLS);

    for (let i = 0; i < TRADITIONAL.length; i++) {
      const { row, col } = TRADITIONAL[i];
      const { type, color } = shuffled[i];
      this.board[row][col] = {
        piece: type,
        color,
        hidden: true,
        owner: row >= 5 ? 'red' : 'black',
      };
    }
  }

  initDarkBoard() {
    const shuffled = shuffleArray(createPieceSet());
    this.board = createEmptyBoard(DARK_ROWS, DARK_COLS);

    for (let i = 0; i < shuffled.length; i++) {
      const row = Math.floor(i / DARK_COLS);
      const col = i % DARK_COLS;
      const { type, color } = shuffled[i];
      this.board[row][col] = {
        piece: type,
        color,
        hidden: true,
        owner: null,
      };
    }
  }

  addPlayer(socketId, color) {
    this.players[color] = socketId;
    if (this.players.red && this.players.black) {
      this.status = 'playing';
    }
  }

  removePlayer(socketId) {
    for (const color of ['red', 'black']) {
      if (this.players[color] === socketId) this.players[color] = null;
    }
    if (this.status === 'playing') {
      this.status = 'finished';
      this.winner = this.players.red ? 'red' : this.players.black ? 'black' : null;
      this.resultReason = 'opponent_disconnected';
    }
  }

  getValidMovesForPlayer(row, col, playerColor) {
    const cell = this.board[row]?.[col];
    if (!cell || cell.owner !== playerColor) return [];
    if (this.mode === 'dark') {
      if (cell.hidden) return [];
      return getDarkValidMoves(this.board, row, col);
    }
    return getChaosValidMoves(this.board, row, col);
  }

  flipPiece(row, col, playerColor) {
    if (this.mode !== 'dark') return { ok: false, error: 'flips are only available in normal dark chess' };
    if (this.status !== 'playing') return { ok: false, error: 'game not in progress' };
    if (this.currentTurn !== playerColor) return { ok: false, error: 'not your turn' };

    const cell = this.board[row]?.[col];
    if (!cell || !cell.hidden) return { ok: false, error: 'no hidden piece there' };

    cell.hidden = false;
    cell.owner = cell.color;
    this.currentTurn = opponentColor(playerColor);

    const move = {
      type: 'flip',
      row,
      col,
      piece: cell.piece,
      color: cell.color,
      owner: cell.owner,
    };
    this.moveHistory.push(move);

    return {
      ok: true,
      move,
      gameOver: false,
      winner: null,
      reason: '',
      currentTurn: this.currentTurn,
    };
  }

  tryMove(fromRow, fromCol, toRow, toCol, playerColor) {
    if (this.status !== 'playing') return { ok: false, error: 'game not in progress' };
    if (this.currentTurn !== playerColor) return { ok: false, error: 'not your turn' };

    if (this.mode === 'dark') {
      return this.tryDarkMove(fromRow, fromCol, toRow, toCol, playerColor);
    }
    return this.tryChaosMove(fromRow, fromCol, toRow, toCol, playerColor);
  }

  tryChaosMove(fromRow, fromCol, toRow, toCol, playerColor) {
    const cell = this.board[fromRow]?.[fromCol];
    if (!cell || !cell.piece) return { ok: false, error: 'no piece there' };
    if (cell.owner !== playerColor) return { ok: false, error: 'not your piece' };

    const validMoves = this.getValidMovesForPlayer(fromRow, fromCol, playerColor);
    if (!validMoves.some((m) => m.row === toRow && m.col === toCol)) {
      return { ok: false, error: 'invalid move' };
    }

    const target = this.board[toRow][toCol];
    const captured = captureInfo(target, toRow, toCol);
    const piece = { ...cell };
    const wasHidden = piece.hidden;
    let ownerChanged = false;

    this.board[fromRow][fromCol] = null;

    if (piece.hidden) {
      piece.hidden = false;
      ownerChanged = piece.owner !== piece.color;
      piece.owner = piece.color;
    }

    this.board[toRow][toCol] = piece;

    const result = this.finishGeneralCaptureIfNeeded(captured, playerColor);
    if (!result.gameOver) this.currentTurn = opponentColor(playerColor);

    const move = {
      type: 'move',
      fromRow,
      fromCol,
      toRow,
      toCol,
      piece: piece.piece,
      color: piece.color,
      wasHidden,
      ownerChanged,
      captured,
    };
    this.addResultToMove(move, result);
    this.moveHistory.push(move);

    return {
      ok: true,
      move,
      currentTurn: this.currentTurn,
      ...result,
    };
  }

  tryDarkMove(fromRow, fromCol, toRow, toCol, playerColor) {
    const cell = this.board[fromRow]?.[fromCol];
    if (!cell || !cell.piece) return { ok: false, error: 'no piece there' };
    if (cell.hidden) return { ok: false, error: 'flip hidden pieces before moving them' };
    if (cell.owner !== playerColor) return { ok: false, error: 'not your piece' };

    const validMoves = this.getValidMovesForPlayer(fromRow, fromCol, playerColor);
    if (!validMoves.some((m) => m.row === toRow && m.col === toCol)) {
      return { ok: false, error: 'invalid move' };
    }

    const target = this.board[toRow][toCol];
    const captured = captureInfo(target, toRow, toCol);
    const piece = { ...cell };

    this.board[fromRow][fromCol] = null;
    this.board[toRow][toCol] = piece;

    let result = { gameOver: false, winner: null, reason: '' };
    if (captured && !this.hasAnyPieceOfColor(opponentColor(playerColor))) {
      result = { gameOver: true, winner: playerColor, reason: 'all_captured' };
      this.status = 'finished';
      this.winner = playerColor;
      this.resultReason = 'all_captured';
    } else {
      this.currentTurn = opponentColor(playerColor);
    }

    const move = {
      type: 'move',
      fromRow,
      fromCol,
      toRow,
      toCol,
      piece: piece.piece,
      color: piece.color,
      wasHidden: false,
      ownerChanged: false,
      captured,
    };
    this.addResultToMove(move, result);
    this.moveHistory.push(move);

    return {
      ok: true,
      move,
      currentTurn: this.currentTurn,
      ...result,
    };
  }

  finishGeneralCaptureIfNeeded(captured, playerColor) {
    if (!captured || captured.piece !== 'general') {
      return { gameOver: false, winner: null, reason: '' };
    }

    const ownGeneral = captured.color === playerColor;
    const winner = ownGeneral ? opponentColor(playerColor) : playerColor;
    const reason = ownGeneral ? 'own_general_captured' : 'general_lost';
    this.status = 'finished';
    this.winner = winner;
    this.resultReason = reason;
    return { gameOver: true, winner, reason };
  }

  addResultToMove(move, result) {
    if (!result.gameOver) return;
    move.gameOver = true;
    move.winner = result.winner;
    move.reason = result.reason;
  }

  hasAnyPieceOfColor(color) {
    for (const row of this.board) {
      for (const cell of row) {
        if (cell?.color === color) return true;
      }
    }
    return false;
  }

  getPublicState(forColor) {
    const boardView = createEmptyBoard(this.rows, this.cols);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.board[row][col];
        if (!cell) continue;
        boardView[row][col] = {
          hidden: cell.hidden,
          owner: cell.owner,
          piece: !cell.hidden ? cell.piece : null,
          color: !cell.hidden ? cell.color : null,
        };
      }
    }

    return {
      mode: this.mode,
      rows: this.rows,
      cols: this.cols,
      board: boardView,
      currentTurn: this.currentTurn,
      status: this.status,
      winner: this.winner,
      resultReason: this.resultReason,
      yourColor: forColor,
      moveHistory: this.moveHistory,
      players: {
        red: this.players.red ? 'connected' : 'waiting',
        black: this.players.black ? 'connected' : 'waiting',
      },
      rematch: {
        red: Boolean(this.rematchRequests.red),
        black: Boolean(this.rematchRequests.black),
      },
    };
  }

  requestRematch(color) {
    if (this.status !== 'finished') return { ok: false, error: 'game not finished' };
    if (!this.players[color]) return { ok: false, error: 'not in this game' };

    this.rematchRequests[color] = true;

    const bothReady = this.rematchRequests.red && this.rematchRequests.black;
    return { ok: true, ready: bothReady, who: color };
  }

  resetForRematch() {
    this.board = null;
    this.currentTurn = 'red';
    this.moveHistory = [];
    this.status = this.players.red && this.players.black ? 'playing' : 'waiting';
    this.winner = null;
    this.resultReason = '';
    this.rematchRequests = { red: false, black: false };
    this.initBoard();
  }

  isJoinable() {
    return (this.status === 'waiting' || this.status === 'finished')
      && !(this.players.red && this.players.black);
  }

  getStatus() {
    return {
      status: this.status,
      currentTurn: this.currentTurn,
      winner: this.winner,
      isCheck: false,
    };
  }
}

module.exports = { GameSession };
