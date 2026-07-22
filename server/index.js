const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { GameSession } = require('./game/session');
const { findTraditionalType } = require('./game/moves');
const { ThreeGameSession } = require('./game/three/session');
const { THREE_FACTIONS } = require('./game/three/constants');

const VALID_MODES = ['chaos', 'dark', 'three-open', 'three-dark'];
const TWO_COLORS = ['red', 'black'];

function createGameSession(roomId, mode) {
  if (mode === 'three-open' || mode === 'three-dark') {
    return new ThreeGameSession(roomId, mode);
  }
  return new GameSession(roomId, mode);
}

// 是否为三人模式会话
function isThreeSession(session) {
  return session instanceof ThreeGameSession;
}

// 某会话允许的阵营（座位）集合
function seatsOf(session) {
  return isThreeSession(session) ? THREE_FACTIONS : TWO_COLORS;
}

// 安全回调封装：客户端未提供 callback 时不抛异常，返回是否成功调用。
function safeCallback(callback, payload) {
  if (typeof callback === 'function') {
    try { callback(payload); return true; } catch (_) { return false; }
  }
  return false;
}

// 校验 roomId 字符串合法性
function isValidRoomId(id) {
  return typeof id === 'string' && /^[A-Z0-9]{6}$/.test(id);
}

// 校验阵营对该会话是否合法
function isValidColor(session, color) {
  return seatsOf(session).includes(color);
}

const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 3030;
const SERVICE_TYPE = 'chess';

function getLanAddresses() {
  const addresses = [];
  const seen = new Set();
  const virtualPattern = /virtual|vethernet|wsl|hyper-v|vmware|virtualbox|vpn|tun|tap|docker|nat|loopback|pseudo/i;
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isIpv4 || entry.internal || !entry.address) continue;
      if (entry.address.startsWith('169.254.')) continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      const physicalPriority = /wi-?fi|wlan|wireless|无线/i.test(name)
        ? 0
        : /ethernet|以太网/i.test(name) && !virtualPattern.test(name)
          ? 1
          : virtualPattern.test(name)
            ? 3
            : 2;
      addresses.push({ address: entry.address, physicalPriority });
    }
  }
  return addresses
    .sort((a, b) => a.physicalPriority - b.physicalPriority
      || a.address.localeCompare(b.address, undefined, { numeric: true }))
    .map((entry) => entry.address);
}

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
  const hostName = options.hostName || `奶棋-${generateHostId()}`;
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
    // 通用：遍历所有已入座阵营，各自推送其视角的状态。
    const colors = seatsOf(session);
    for (const color of colors) {
      const sid = session.players[color];
      if (!sid) continue;
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('game_state', session.getPublicState(color));
    }
    io.to(roomId).emit('game_status', session.getStatus());
  }

  function getJoinableRooms() {
    const list = [];
    for (const [roomId, session] of rooms.entries()) {
      if (!session.isJoinable()) continue;
      const colors = seatsOf(session);
      const taken = colors.filter((c) => session.players[c]);
      list.push({ roomId, mode: session.mode, taken, seatsTaken: taken.length, seats: colors.length });
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
      if (session) {
        if (info.color) session.removePlayer(socket.id);
        const colors = seatsOf(session);
        const seatedColors = colors.filter((c) => session.players[c]);
        if (seatedColors.length > 0) {
          emitSessionState(info.roomId, session);
          if (info.color) io.to(info.roomId).emit('opponent_left', { color: info.color });
        } else {
          // The creator may leave before choosing a seat; remove that empty room too.
          rooms.delete(info.roomId);
        }
      }
      broadcastRoomsUpdate();
    }
    socketRooms.delete(socket.id);
  }

  // Health/info endpoint used by LAN discovery probes (no socket handshake needed).
  app.get('/__chess_info__', (_req, res) => {
    const addresses = getLanAddresses();
    res.json({
      hostName: hostInfo.hostName,
      hostId: hostInfo.hostId,
      port: hostInfo.port,
      platform: process.platform,
      addresses,
      urls: addresses.map((address) => `http://${address}:${hostInfo.port}`),
      openRooms: getJoinableRooms().length,
      service: SERVICE_TYPE,
    });
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // 强制一个连接只能属于一个房间、占一个座位。切换房间前先完整离开旧房间。
    function ensureLeftPreviousRoom() {
      const prev = socketRooms.get(socket.id);
      if (prev && prev.roomId) {
        leaveRoom(socket);
      }
    }

    socket.on('enter_lobby', () => {
      lobby.add(socket.id);
      socket.emit('rooms_update', getJoinableRooms());
    });
    socket.on('exit_lobby', () => { lobby.delete(socket.id); });

    socket.on('create_room', (payload, callback) => {
      try {
        payload = payload || {};
        const mode = VALID_MODES.includes(payload.mode) ? payload.mode : 'chaos';
        ensureLeftPreviousRoom();
        let roomId = generateRoomId();
        while (rooms.has(roomId)) roomId = generateRoomId();
        const session = createGameSession(roomId, mode);
        rooms.set(roomId, session);
        socketRooms.set(socket.id, { roomId, color: null });
        socket.join(roomId);
        lobby.delete(socket.id);
        broadcastRoomsUpdate();
        const colors = seatsOf(session);
        safeCallback(callback, { ok: true, roomId, mode: session.mode, taken: [], seats: colors });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('join_room', (payload, callback) => {
      try {
        const roomId = payload?.roomId;
        if (!isValidRoomId(roomId)) return safeCallback(callback, { ok: false, error: 'Invalid room id' });
        const session = rooms.get(roomId);
        if (!session) return safeCallback(callback, { ok: false, error: 'Room not found' });
        if (session.status === 'finished') {
          return safeCallback(callback, { ok: false, error: 'Game already finished' });
        }
        const colors = seatsOf(session);
        if (colors.every((c) => session.players[c])) {
          return safeCallback(callback, { ok: false, error: 'Room is full' });
        }
        ensureLeftPreviousRoom();
        socketRooms.set(socket.id, { roomId, color: null });
        socket.join(roomId);
        lobby.delete(socket.id);
        const taken = colors.filter((c) => session.players[c]);
        safeCallback(callback, { ok: true, roomId, mode: session.mode, taken, seats: colors });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('select_color', (payload, callback) => {
      try {
        const roomId = payload?.roomId;
        const color = payload?.color;
        const info = socketRooms.get(socket.id);
        // 必须已 join 该房间
        if (!info || info.roomId !== roomId) {
          return safeCallback(callback, { ok: false, error: 'Join the room first' });
        }
        const session = rooms.get(roomId);
        if (!session) return safeCallback(callback, { ok: false, error: 'Room not found' });
        // 阵营合法性
        if (!isValidColor(session, color)) {
          return safeCallback(callback, { ok: false, error: 'Invalid color' });
        }
        // 该连接是否已占座
        if (info.color) {
          return safeCallback(callback, { ok: false, error: 'Already seated' });
        }
        // 该座是否已被别人占
        if (session.players[color] && session.players[color] !== socket.id) {
          return safeCallback(callback, { ok: false, error: 'Color taken' });
        }

        session.addPlayer(socket.id, color);
        info.color = color;

        socket.emit('game_state', session.getPublicState(color));
        broadcastRoomsUpdate();

        const colors = seatsOf(session);
        if (session.status === 'playing') {
          // 通知所有其他已入座玩家更新状态
          for (const c of colors) {
            if (c === color) continue;
            const sid = session.players[c];
            if (!sid) continue;
            const s = io.sockets.sockets.get(sid);
            if (s) s.emit('game_state', session.getPublicState(c));
          }
          io.to(roomId).emit('game_status', session.getStatus());
        } else {
          socket.to(roomId).emit('opponent_joined', { color });
        }
        safeCallback(callback, { ok: true, color });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    // 三人模式：查询合法走法（用 cellKey）
    socket.on('get_three_moves', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, moves: [] });
        const session = rooms.get(info.roomId);
        if (!session || !isThreeSession(session)) return safeCallback(callback, { ok: false, moves: [] });
        safeCallback(callback, { ok: true, moves: session.getValidMovesForPlayer(payload?.key, info.color) });
      } catch (e) {
        safeCallback(callback, { ok: false, moves: [] });
      }
    });

    // 三人模式：走子（用 fromKey/toKey）
    socket.on('make_three_move', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session || !isThreeSession(session)) return safeCallback(callback, { ok: false, error: 'Room not found' });

        const result = session.tryMove(payload?.fromKey, payload?.toKey, info.color);
        if (!result.ok) return safeCallback(callback, { ok: false, error: result.error });

        io.to(info.roomId).emit('move_made', { move: result.move, currentTurn: result.currentTurn });
        emitSessionState(info.roomId, session);
        if (result.gameOver) {
          io.to(info.roomId).emit('game_over', { winner: result.winner, reason: result.reason });
        }
        safeCallback(callback, { ok: true });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    // 三人模式：翻面（暗棋）
    socket.on('flip_three_piece', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session || !isThreeSession(session)) return safeCallback(callback, { ok: false, error: 'Room not found' });

        const result = session.flipPiece(payload?.key, info.color);
        if (!result.ok) return safeCallback(callback, { ok: false, error: result.error });

        io.to(info.roomId).emit('move_made', { move: result.move, currentTurn: result.currentTurn });
        emitSessionState(info.roomId, session);
        safeCallback(callback, { ok: true });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('get_valid_moves', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, moves: [] });
        const session = rooms.get(info.roomId);
        if (!session) return safeCallback(callback, { ok: false, moves: [] });
        safeCallback(callback, { ok: true, moves: session.getValidMovesForPlayer(payload?.row, payload?.col, info.color) });
      } catch (e) {
        safeCallback(callback, { ok: false, moves: [] });
      }
    });

    socket.on('make_move', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session) return safeCallback(callback, { ok: false, error: 'Room not found' });

        const result = session.tryMove(payload?.fromRow, payload?.fromCol, payload?.toRow, payload?.toCol, info.color);
        if (!result.ok) return safeCallback(callback, { ok: false, error: result.error });

        io.to(info.roomId).emit('move_made', { move: result.move, currentTurn: result.currentTurn });
        emitSessionState(info.roomId, session);
        if (result.gameOver) {
          io.to(info.roomId).emit('game_over', { winner: result.winner, reason: result.reason });
        }
        safeCallback(callback, { ok: true });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('flip_piece', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session) return safeCallback(callback, { ok: false, error: 'Room not found' });

        const result = session.flipPiece(payload?.row, payload?.col, info.color);
        if (!result.ok) return safeCallback(callback, { ok: false, error: result.error });

        io.to(info.roomId).emit('move_made', { move: result.move, currentTurn: result.currentTurn });
        emitSessionState(info.roomId, session);
        safeCallback(callback, { ok: true });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('get_game_state', (_payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        if (!info || !info.roomId || !info.color) return safeCallback(callback, { ok: false, error: 'Not in a game' });
        const session = rooms.get(info.roomId);
        if (!session) return safeCallback(callback, { ok: false, error: 'Room not found' });
        socket.emit('game_state', session.getPublicState(info.color));
        safeCallback(callback, { ok: true });
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('get_traditional_type', (payload, callback) => {
      try {
        safeCallback(callback, { ok: true, type: findTraditionalType(payload?.row, payload?.col) });
      } catch (e) {
        safeCallback(callback, { ok: false, type: null });
      }
    });

    socket.on('request_rematch', (payload, callback) => {
      try {
        const info = socketRooms.get(socket.id);
        const useRoomId = payload?.roomId || info?.roomId;
        if (!useRoomId) return safeCallback(callback, { ok: false, error: 'Not in a room' });
        const session = rooms.get(useRoomId);
        if (!session) return safeCallback(callback, { ok: false, error: 'Room not found' });
        const color = info?.color;
        if (!color || !session.players[color]) return safeCallback(callback, { ok: false, error: 'Not in this game' });

        const res = session.requestRematch(color);
        if (!res.ok) return safeCallback(callback, { ok: false, error: res.error });

        // 通知所有其他已入座玩家
        const colors = seatsOf(session);
        for (const c of colors) {
          if (c === color) continue;
          const sid = session.players[c];
          if (!sid) continue;
          const s = io.sockets.sockets.get(sid);
          if (s) s.emit('rematch_update', { who: color, ready: res.ready });
        }

        if (res.ready) {
          session.resetForRematch();
          emitSessionState(useRoomId, session);
          io.to(useRoomId).emit('rematch_started', {});
          safeCallback(callback, { ok: true, ready: true });
        } else {
          safeCallback(callback, { ok: true, ready: false });
        }
      } catch (e) {
        safeCallback(callback, { ok: false, error: e.message });
      }
    });

    socket.on('leave_room', (_payload, callback) => {
      leaveRoom(socket);
      safeCallback(callback, { ok: true });
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      lobby.delete(socket.id);
      const info = socketRooms.get(socket.id);
      if (info && info.roomId) {
        const session = rooms.get(info.roomId);
        if (session) {
          session.removePlayer(socket.id);
          const colors = seatsOf(session);
          const anySeated = colors.some((c) => session.players[c]);
          if (anySeated) {
            // 仍有人在场：通知更新状态（三人模式可能继续，双人则结束）
            io.to(info.roomId).emit('opponent_disconnected', { socketId: socket.id });
            if (session.status === 'finished') {
              // 游戏结束：推送最终状态 + game_over
              emitSessionState(info.roomId, session);
              io.to(info.roomId).emit('game_over', { winner: session.winner, reason: 'opponent_disconnected' });
            } else {
              emitSessionState(info.roomId, session);
            }
          } else {
            // 无人则删除房间
            io.to(info.roomId).emit('opponent_disconnected', { socketId: socket.id });
            io.to(info.roomId).emit('game_over', { winner: session.winner, reason: 'opponent_disconnected' });
            rooms.delete(info.roomId);
          }
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
    for (const address of getLanAddresses()) {
      console.log(`LAN:      http://${address}:${DEFAULT_PORT}`);
    }
    if (bonjour) {
      const mdns = new bonjour.Bonjour();
      handle.advertise(mdns);
      console.log(`Advertising on LAN as "${handle.hostInfo.hostName}" (mDNS)`);
    } else {
      console.log('(bonjour-service not installed; skipping mDNS advertise)');
    }
  });
}

module.exports = { createServer, getLanAddresses, SERVICE_TYPE, DEFAULT_PORT };
