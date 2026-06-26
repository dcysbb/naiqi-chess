const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { GameSession } = require('./game/session');
const { findTraditionalType } = require('./game/moves');

const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 3030;
const SERVICE_TYPE = 'chess';

function generateHostId() {
  const host = os.hostname() || 'chess-host';
  return host.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'host';
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Create (but do NOT listen on) the game server. Returns a handle the caller
 * can start/stop. This makes the server embeddable by Electron's main process.
 *
 * Options:
 *   - port:     desired port (recorded in hostInfo; the caller is responsible for listen)
 *   - hostName: human-friendly name advertised over mDNS (default: derived from hostname)
 *   - clientDir: static dir to serve (default: ../client/dist)
 */
function createServer(options = {}) {
  const clientDir = options.clientDir || path.join(__dirname, '..', 'client', 'dist');
  const hostName = options.hostName || `象棋-${generateHostId()}`;
  const port = options.port || DEFAULT_PORT;
  const hostInfo = { hostName, hostId: generateHostId(), port };

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(cors());
  app.use(express.static(clientDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  }));

  const rooms = new Map();
  const socketRooms = new Map();
  const lobby = new Set();

  function emitSessionState(roomId, session) {
    const redSocket = session.players.red ? io.sockets.sockets.get(session.players.red) : null;
    const blackSocket = session.players.black ? io.sockets.sockets.get(session.players.black) : null;
    if (redSocket) redSocket.emit('game_state', session.getPublicState('red'));
    if (blackSocket) blackSocket.emit('game_state', session.getPublicState('black'));
    io.to(roomId).emit('game_status', session.getStatus());
  }

  function getJoinableRooms() {
    const list = [];
    for (const [roomId, session] of rooms.entries()) {
      if (!session.isJoinable()) continue;
      const taken = [];
      if (session.players.red) taken.push('red');
      if (session.players.black) taken.push('black');
      list.push({ roomId, mode: session.mode, taken, seatsTaken: taken.length });
    }
    return list.sort((a, b) => a.roomId.localeCompare(b.roomId));
  }

  function broadcastRoomsUpdate() {
    const list = getJoinableRooms();
    for (const socketId of lobby) {
      const s = io.sockets.sockets.get(socketId);
      if (s) s.emit('rooms_update', list);
    }
  }

  function leaveRoom(socket) {
    const info = socketRooms.get(socket.id);
    lobby.delete(socket.id);
    if (info && info.roomId) {
      const session = rooms.get(info.roomId);
      socket.leave(info.roomId);
      if (session && info.color) {
        session.removePlayer(socket.id);
        const remainingSocket = session.players.red || session.players.black;
        if (remainingSocket) {
          const rs = io.sockets.sockets.get(remainingSocket);
          if (rs) {
            rs.emit('opponent_left', {});
            rs.emit('game_state', session.getPublicState(
              session.players.red ? 'red' : 'black'
            ));
          }
        }
        if (!session.players.red && !session.players.black) {
          rooms.delete(info.roomId);
        }
      }
      broadcastRoomsUpdate();
    }
    socketRooms.delete(socket.id);
  }

  // Health/info endpoint used by LAN discovery probes (no socket handshake needed).
  app.get('/__chess_info__', (_req, res) => {
    res.json({
      hostName: hostInfo.hostName,
      hostId: hostInfo.hostId,
      openRooms: getJoinableRooms().length,
      service: SERVICE_TYPE,
    });
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('enter_lobby', () => {
      lobby.add(socket.id);
      socket.emit('rooms_update', getJoinableRooms());
    });
    socket.on('exit_lobby', () => { lobby.delete(socket.id); });

    socket.on('create_room', (payload = {}, callback) => {
      try {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();
        const session = new GameSession(roomId, payload.mode);
        rooms.set(roomId, session);
        socketRooms.set(socket.id, { roomId, color: null });
        socket.join(roomId);
        lobby.delete(socket.id);
        broadcastRoomsUpdate();
        callback({ ok: true, roomId, mode: session.mode, taken: [] });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('join_room', ({ roomId }, callback) => {
      try {
        const session = rooms.get(roomId);
        if (!session) return callback({ ok: false, error: 'Room not found' });
        if (session.players.red && session.players.black) {
          return callback({ ok: false, error: 'Room is full' });
        }
        socketRooms.set(socket.id, { roomId, color: null });
        socket.join(roomId);
        lobby.delete(socket.id);
        const taken = [];
        if (session.players.red) taken.push('red');
        if (session.players.black) taken.push('black');
        callback({ ok: true, roomId, mode: session.mode, taken });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('select_color', ({ roomId, color }, callback) => {
      try {
        const session = rooms.get(roomId);
        if (!session) return callback({ ok: false, error: 'Room not found' });
        if (session.players[color]) return callback({ ok: false, error: 'Color taken' });

        session.addPlayer(socket.id, color);
        const existing = socketRooms.get(socket.id);
        if (existing) existing.color = color;

        socket.emit('game_state', session.getPublicState(color));
        broadcastRoomsUpdate();

        if (session.status === 'playing') {
          const oppColor = color === 'red' ? 'black' : 'red';
          const oppSocketId = session.players[oppColor];
          const oppSocket = oppSocketId ? io.sockets.sockets.get(oppSocketId) : null;
          if (oppSocket) oppSocket.emit('game_state', session.getPublicState(oppColor));
          io.to(roomId).emit('game_status', session.getStatus());
        } else {
          socket.to(roomId).emit('opponent_joined', { color });
        }
        callback({ ok: true, color });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('get_valid_moves', ({ row, col }, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return callback({ ok: false, moves: [] });
        const session = rooms.get(info.roomId);
        if (!session) return callback({ ok: false, moves: [] });
        callback({ ok: true, moves: session.getValidMovesForPlayer(row, col, info.color) });
      } catch (e) {
        callback({ ok: false, moves: [] });
      }
    });

    socket.on('make_move', ({ fromRow, fromCol, toRow, toCol }, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return callback({ ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session) return callback({ ok: false, error: 'Room not found' });

        const result = session.tryMove(fromRow, fromCol, toRow, toCol, info.color);
        if (!result.ok) return callback({ ok: false, error: result.error });

        io.to(info.roomId).emit('move_made', { move: result.move, currentTurn: result.currentTurn });
        emitSessionState(info.roomId, session);
        if (result.gameOver) {
          io.to(info.roomId).emit('game_over', { winner: result.winner, reason: result.reason });
        }
        callback({ ok: true });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('flip_piece', ({ row, col }, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return callback({ ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session) return callback({ ok: false, error: 'Room not found' });

        const result = session.flipPiece(row, col, info.color);
        if (!result.ok) return callback({ ok: false, error: result.error });

        io.to(info.roomId).emit('move_made', { move: result.move, currentTurn: result.currentTurn });
        emitSessionState(info.roomId, session);
        callback({ ok: true });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('get_game_state', (_, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return callback({ ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session) return callback({ ok: false, error: 'Room not found' });
        socket.emit('game_state', session.getPublicState(info.color));
        callback({ ok: true });
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('get_traditional_type', ({ row, col }, callback) => {
      try {
        callback({ ok: true, type: findTraditionalType(row, col) });
      } catch (e) {
        callback({ ok: false, type: null });
      }
    });

    socket.on('request_rematch', ({ roomId } = {}, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        const useRoomId = roomId || info?.roomId;
        if (!useRoomId) return callback({ ok: false, error: 'Not in a room' });
        const session = rooms.get(useRoomId);
        if (!session) return callback({ ok: false, error: 'Room not found' });
        const color = info?.color;
        if (!color || !session.players[color]) return callback({ ok: false, error: 'Not in this game' });

        const res = session.requestRematch(color);
        if (!res.ok) return callback({ ok: false, error: res.error });

        const opponentColor = color === 'red' ? 'black' : 'red';
        const oppSocketId = session.players[opponentColor];
        const oppSocket = oppSocketId ? io.sockets.sockets.get(oppSocketId) : null;
        if (oppSocket) oppSocket.emit('rematch_update', { who: color, ready: res.ready });

        if (res.ready) {
          session.resetForRematch();
          emitSessionState(useRoomId, session);
          io.to(useRoomId).emit('rematch_started', {});
          callback({ ok: true, ready: true });
        } else {
          callback({ ok: true, ready: false });
        }
      } catch (e) {
        callback({ ok: false, error: e.message });
      }
    });

    socket.on('leave_room', () => leaveRoom(socket));

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      lobby.delete(socket.id);
      const info = socketRooms.get(socket.id);
      if (info && info.roomId) {
        const session = rooms.get(info.roomId);
        if (session) {
          session.removePlayer(socket.id);
          io.to(info.roomId).emit('opponent_disconnected', { socketId: socket.id });
          io.to(info.roomId).emit('game_over', { winner: session.winner, reason: 'opponent_disconnected' });
          if (!session.players.red && !session.players.black) rooms.delete(info.roomId);
        }
        broadcastRoomsUpdate();
      }
      socketRooms.delete(socket.id);
    });
  });

  let mdnsService = null;
  let mdnsRef = null;

  function advertise(mdns) {
    if (!mdns) return;
    mdnsRef = mdns;
    mdnsService = mdns.publish({
      name: hostInfo.hostName,
      type: SERVICE_TYPE,
      port: hostInfo.port,
      txt: { hostId: hostInfo.hostId, hostName: hostInfo.hostName },
    });
  }

  function stop() {
    if (mdnsRef && mdnsService) {
      try { mdnsRef.unpublish(mdnsService); } catch (_) { /* ignore */ }
    }
    return new Promise((resolve) => {
      io.close(() => httpServer.close(() => resolve()));
    });
  }

  return { app, httpServer, io, hostInfo, getJoinableRooms, advertise, stop };
}

// --- Standalone entrypoint (preserves `npm start` / `node index.js`) ---
if (require.main === module) {
  let bonjour = null;
  try { bonjour = require('bonjour-service'); } catch (_) { bonjour = null; }

  const handle = createServer({ port: DEFAULT_PORT });
  handle.httpServer.listen(DEFAULT_PORT, () => {
    console.log(`Chess server running on port ${DEFAULT_PORT}`);
    console.log(`Internal: http://localhost:${DEFAULT_PORT}`);
    if (bonjour) {
      const mdns = new bonjour.Bonjour();
      handle.advertise(mdns);
      console.log(`Advertising on LAN as "${handle.hostInfo.hostName}" (mDNS)`);
    } else {
      console.log('(bonjour-service not installed; skipping mDNS advertise)');
    }
  });
}

module.exports = { createServer, SERVICE_TYPE, DEFAULT_PORT };
