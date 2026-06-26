const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { GameSession } = require('./server/game/session');
const { ROWS, COLS, DARK_ROWS, DARK_COLS } = require('./server/game/constants');

const SERVER = 'http://localhost:3030';

async function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function emptyBoard(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function put(session, row, col, piece, color, owner, hidden = false) {
  session.board[row][col] = { piece, color, owner, hidden };
}

function readySession(mode) {
  const session = new GameSession('TEST', mode);
  session.board = emptyBoard(session.rows, session.cols);
  session.players = { red: 'red-socket', black: 'black-socket' };
  session.status = 'playing';
  session.currentTurn = 'red';
  session.winner = null;
  session.resultReason = '';
  session.moveHistory = [];
  return session;
}

function findPiece(session, piece, color) {
  for (let row = 0; row < session.rows; row++) {
    for (let col = 0; col < session.cols; col++) {
      const cell = session.board[row][col];
      if (cell?.piece === piece && cell.color === color) return { row, col };
    }
  }
  return null;
}

function assertMove(moves, row, col, message) {
  assert.ok(moves.some((move) => move.row === row && move.col === col), message);
}

function assertNoMove(moves, row, col, message) {
  assert.ok(!moves.some((move) => move.row === row && move.col === col), message);
}

function runChaosRuleTests() {
  console.log('=== CHAOS MODE RULE TESTS ===');
  assert.equal(new GameSession('A').mode, 'chaos');
  assert.equal(new GameSession('A').rows, ROWS);
  assert.equal(new GameSession('A').cols, COLS);

  let redGeneralMoved = false;
  let blackGeneralMoved = false;
  for (let i = 0; i < 120; i++) {
    const session = new GameSession(`RANDOM-${i}`, 'chaos');
    const redGeneral = findPiece(session, 'general', 'red');
    const blackGeneral = findPiece(session, 'general', 'black');
    assert.ok(redGeneral);
    assert.ok(blackGeneral);
    if (redGeneral.row !== 9 || redGeneral.col !== 4) redGeneralMoved = true;
    if (blackGeneral.row !== 0 || blackGeneral.col !== 4) blackGeneralMoved = true;
  }
  assert.ok(redGeneralMoved);
  assert.ok(blackGeneralMoved);

  let session = readySession('chaos');
  put(session, 6, 0, 'chariot', 'black', 'red', true);
  let moves = session.getValidMovesForPlayer(6, 0, 'red');
  assertMove(moves, 5, 0, 'hidden chaos piece should move by square type');
  assertNoMove(moves, 6, 1, 'hidden chaos piece should not move by real identity');
  let result = session.tryMove(6, 0, 5, 0, 'red');
  assert.equal(result.ok, true);
  assert.equal(session.board[5][0].hidden, false);
  assert.equal(session.board[5][0].owner, 'black');

  session = readySession('chaos');
  put(session, 5, 0, 'general', 'red', 'red', false);
  moves = session.getValidMovesForPlayer(5, 0, 'red');
  assertMove(moves, 4, 0, 'revealed chaos general should move outside palace');
  assertMove(moves, 6, 0, 'revealed chaos general should move outside palace');
  assertMove(moves, 5, 1, 'revealed chaos general should move outside palace');

  session = readySession('chaos');
  put(session, 5, 0, 'advisor', 'red', 'red', false);
  moves = session.getValidMovesForPlayer(5, 0, 'red');
  assertMove(moves, 4, 1, 'revealed chaos advisor should move diagonally outside palace');
  assertMove(moves, 6, 1, 'revealed chaos advisor should move diagonally outside palace');

  session = readySession('chaos');
  put(session, 5, 2, 'elephant', 'red', 'red', false);
  moves = session.getValidMovesForPlayer(5, 2, 'red');
  assertMove(moves, 3, 0, 'revealed chaos elephant should cross river');
  assertMove(moves, 3, 4, 'revealed chaos elephant should cross river');

  session = readySession('chaos');
  put(session, 9, 4, 'chariot', 'red', 'red', true);
  moves = session.getValidMovesForPlayer(9, 4, 'red');
  assertMove(moves, 8, 4, 'hidden chaos piece on general square uses palace move');
  assertMove(moves, 9, 3, 'hidden chaos piece on general square uses palace move');
  assertNoMove(moves, 6, 4, 'hidden chaos piece still cannot ignore palace rules');

  session = readySession('chaos');
  put(session, 5, 0, 'chariot', 'red', 'red', false);
  put(session, 5, 5, 'pawn', 'black', 'red', true);
  moves = session.getValidMovesForPlayer(5, 0, 'red');
  assertMove(moves, 5, 5, 'chaos pieces can capture hidden pieces in own temporary area');
  result = session.tryMove(5, 0, 5, 5, 'red');
  assert.equal(result.ok, true);
  assert.equal(result.move.captured.wasHidden, true);
  assert.equal(result.move.captured.piece, 'pawn');
  assert.equal(result.move.captured.color, 'black');

  session = readySession('chaos');
  put(session, 5, 0, 'chariot', 'red', 'red', false);
  put(session, 5, 5, 'general', 'red', 'black', true);
  result = session.tryMove(5, 0, 5, 5, 'red');
  assert.equal(result.gameOver, true);
  assert.equal(result.winner, 'black');
  assert.equal(result.reason, 'own_general_captured');
  console.log('✓ chaos mode keeps existing custom rules');
}

function runDarkRuleTests() {
  console.log('\n=== NORMAL DARK CHESS RULE TESTS ===');
  const random = new GameSession('DARK', 'dark');
  assert.equal(random.mode, 'dark');
  assert.equal(random.rows, DARK_ROWS);
  assert.equal(random.cols, DARK_COLS);
  assert.equal(random.board.flat().filter(Boolean).length, 32);
  assert.ok(findPiece(random, 'general', 'red'));
  assert.ok(findPiece(random, 'general', 'black'));

  let session = readySession('dark');
  put(session, 0, 0, 'advisor', 'red', null, true);
  let result = session.flipPiece(0, 0, 'red');
  assert.equal(result.ok, true);
  assert.equal(result.gameOver, false);
  assert.equal(session.status, 'playing');
  assert.equal(session.board[0][0].hidden, false);
  assert.equal(session.board[0][0].owner, 'red');
  assert.equal(session.currentTurn, 'black');

  session = readySession('dark');
  put(session, 1, 1, 'chariot', 'red', 'red', false);
  let moves = session.getValidMovesForPlayer(1, 1, 'red');
  assertMove(moves, 0, 1, 'normal pieces can move one step');
  assertMove(moves, 1, 0, 'normal pieces can move one step');
  assertNoMove(moves, 1, 3, 'normal pieces cannot slide');

  session = readySession('dark');
  put(session, 1, 1, 'general', 'red', 'red', false);
  put(session, 1, 2, 'pawn', 'black', 'black', false);
  moves = session.getValidMovesForPlayer(1, 1, 'red');
  assertNoMove(moves, 1, 2, 'general cannot capture pawn in normal dark chess');

  session = readySession('dark');
  put(session, 1, 1, 'general', 'red', 'red', false);
  put(session, 1, 2, 'pawn', 'black', null, true);
  moves = session.getValidMovesForPlayer(1, 1, 'red');
  assertMove(moves, 1, 2, 'revealed pieces can directly capture hidden pieces');
  result = session.tryMove(1, 1, 1, 2, 'red');
  assert.equal(result.ok, true);
  assert.equal(result.move.captured.wasHidden, true);
  assert.equal(result.move.captured.piece, 'pawn');
  assert.equal(result.move.captured.color, 'black');

  session = readySession('dark');
  put(session, 1, 1, 'pawn', 'red', 'red', false);
  put(session, 1, 2, 'general', 'black', 'black', false);
  moves = session.getValidMovesForPlayer(1, 1, 'red');
  assertMove(moves, 1, 2, 'pawn can capture general in normal dark chess');

  session = readySession('dark');
  put(session, 1, 0, 'cannon', 'red', 'red', false);
  put(session, 1, 2, 'pawn', 'black', 'black', false);
  put(session, 1, 4, 'advisor', 'black', 'black', false);
  moves = session.getValidMovesForPlayer(1, 0, 'red');
  assertMove(moves, 1, 1, 'cannon can move one empty step');
  assertMove(moves, 1, 4, 'cannon captures over exactly one screen');
  assertNoMove(moves, 1, 2, 'cannon cannot capture adjacent piece');

  session = readySession('dark');
  put(session, 1, 1, 'pawn', 'red', 'red', false);
  put(session, 1, 2, 'pawn', 'black', 'black', false);
  result = session.tryMove(1, 1, 1, 2, 'red');
  assert.equal(result.ok, true);
  assert.equal(result.gameOver, true);
  assert.equal(result.winner, 'red');
  assert.equal(result.reason, 'all_captured');
  console.log('✓ normal dark chess flip, move, capture, cannon, and win rules work');
}

function connect(label) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, { transports: ['websocket'] });
    const timeout = setTimeout(() => reject(new Error(`${label} connect timeout`)), 5000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      console.log(`[${label}] connected: ${socket.id}`);
      resolve(socket);
    });
    socket.on('connect_error', reject);
  });
}

function emit(socket, event, data) {
  return new Promise((resolve) => {
    socket.emit(event, data, (response) => {
      console.log(`[${socket.id}] ${event}: ${JSON.stringify(response)}`);
      resolve(response);
    });
  });
}

async function runSocketSmokeTest(mode) {
  console.log(`\n=== SOCKET SMOKE TEST: ${mode} ===`);
  const p1 = await connect(`${mode}-P1`);
  const p2 = await connect(`${mode}-P2`);

  try {
    let response = await emit(p1, 'create_room', { mode });
    assert.equal(response.ok, true);
    assert.equal(response.mode, mode);
    const roomId = response.roomId;

    response = await emit(p1, 'select_color', { roomId, color: 'red' });
    assert.equal(response.ok, true);
    response = await emit(p2, 'join_room', { roomId });
    assert.equal(response.ok, true);
    assert.equal(response.mode, mode);
    response = await emit(p2, 'select_color', { roomId, color: 'black' });
    assert.equal(response.ok, true);

    await delay(200);

    if (mode === 'dark') {
      response = await emit(p1, 'flip_piece', { row: 0, col: 0 });
      assert.equal(response.ok, true);
    } else {
      let chosen = null;
      for (let row = 5; row < ROWS && !chosen; row++) {
        for (let col = 0; col < COLS && !chosen; col++) {
          response = await emit(p1, 'get_valid_moves', { row, col });
          assert.equal(response.ok, true);
          if (response.moves.length > 0) chosen = { from: { row, col }, to: response.moves[0] };
        }
      }
      assert.ok(chosen);
      response = await emit(p1, 'make_move', {
        fromRow: chosen.from.row,
        fromCol: chosen.from.col,
        toRow: chosen.to.row,
        toCol: chosen.to.col,
      });
      assert.equal(response.ok, true);
    }

    console.log(`✓ socket flow works for ${mode}`);
  } finally {
    p1.close();
    p2.close();
  }
}

async function main() {
  runChaosRuleTests();
  runDarkRuleTests();
  await runSocketSmokeTest('chaos');
  await runSocketSmokeTest('dark');
  console.log('\n=== ALL DEBUG TESTS PASSED ===');
}

main().catch((error) => {
  console.error('TEST ERROR:', error);
  process.exit(1);
});
