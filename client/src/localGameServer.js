import { GameSession } from './game/session.js';
import { ThreeGameSession } from './game/three/session.js';
import { THREE_FACTIONS } from './game/three/constants.js';
import { findTraditionalType } from './game/moves.js';

const TWO_COLORS = ['red', 'black'];
const VALID_MODES = ['chaos', 'dark', 'three-open', 'three-dark'];

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function isThreeSession(session) {
  return session instanceof ThreeGameSession;
}

// 某会话允许的阵营（座位）集合
function seatsOf(session) {
  return isThreeSession(session) ? THREE_FACTIONS : TWO_COLORS;
}

function isValidRoomId(id) {
  return typeof id === 'string' && /^[A-Z0-9]{6}$/.test(id);
}

export class LocalGameServer {
  constructor({ hostName = '手机主机', hostId = 'mobile-host', onSend, onRoomsChanged } = {}) {
    this.hostInfo = { hostName, hostId };
    this.rooms = new Map();
    this.clientRooms = new Map();
    this.lobby = new Set();
    this.clients = new Set();
    this.onSend = onSend || (() => {});
    this.onRoomsChanged = onRoomsChanged || (() => {});
  }

  addClient(clientId) {
    if (!clientId) return;
    this.clients.add(clientId);
  }

  removeClient(clientId) {
    if (!clientId || !this.clients.has(clientId)) return;
    this.clients.delete(clientId);
    this.handleDisconnect(clientId);
  }

  info() {
    return {
      hostName: this.hostInfo.hostName,
      hostId: this.hostInfo.hostId,
      openRooms: this.getJoinableRooms().length,
      service: 'chess',
      mobileHost: true,
    };
  }

  send(clientId, event, payload = {}) {
    if (!clientId || !this.clients.has(clientId)) return;
    this.onSend(clientId, event, payload);
  }

  // 通知该房间所有已入座玩家各自视角的状态
  emitSessionState(roomId, session) {
    const colors = seatsOf(session);
    for (const color of colors) {
      const cid = session.players[color];
      if (cid) {
        this.send(cid, 'game_state', session.getPublicState(color));
        this.send(cid, 'game_status', session.getStatus());
      }
    }
  }

  getJoinableRooms() {
    const list = [];
    for (const [roomId, session] of this.rooms.entries()) {
      if (!session.isJoinable()) continue;
      const colors = seatsOf(session);
      const taken = colors.filter((c) => session.players[c]);
      list.push({ roomId, mode: session.mode, taken, seatsTaken: taken.length, seats: colors.length });
    }
    return list.sort((a, b) => a.roomId.localeCompare(b.roomId));
  }

  broadcastRoomsUpdate() {
    const list = this.getJoinableRooms();
    for (const clientId of this.lobby) {
      this.send(clientId, 'rooms_update', list);
    }
    this.onRoomsChanged(this.info());
  }

  // 一个连接只能属于一个房间、占一个座位
  ensureLeftPreviousRoom(clientId) {
    const prev = this.clientRooms.get(clientId);
    if (prev && prev.roomId) {
      this.leaveRoom(clientId);
    }
  }

  leaveRoom(clientId) {
    const info = this.clientRooms.get(clientId);
    this.lobby.delete(clientId);
    if (info?.roomId) {
      const session = this.rooms.get(info.roomId);
      if (session) {
        if (info.color) {
          session.removePlayer(clientId);
          const colors = seatsOf(session);
          const seatedColors = colors.filter((c) => session.players[c]);
          if (seatedColors.length > 0) {
            this.emitSessionState(info.roomId, session);
            this.send(seatedColors.map((c) => session.players[c]), 'opponent_left', { color: info.color });
          } else {
            this.rooms.delete(info.roomId);
          }
        }
        this.broadcastRoomsUpdate();
      }
    }
    this.clientRooms.delete(clientId);
  }

  handleDisconnect(clientId) {
    this.lobby.delete(clientId);
    const info = this.clientRooms.get(clientId);
    if (info?.roomId) {
      const session = this.rooms.get(info.roomId);
      if (session) {
        session.removePlayer(clientId);
        const colors = seatsOf(session);
        const seated = colors.filter((c) => session.players[c]);
        for (const recipient of seated) {
          this.send(recipient, 'opponent_disconnected', { clientId });
        }
        if (session.status === 'finished') {
          this.emitSessionState(info.roomId, session);
          for (const recipient of seated) {
            this.send(recipient, 'game_over', { winner: session.winner, reason: 'opponent_disconnected' });
          }
        } else {
          this.emitSessionState(info.roomId, session);
        }
        if (seated.length === 0) this.rooms.delete(info.roomId);
        this.broadcastRoomsUpdate();
      }
    }
    this.clientRooms.delete(clientId);
  }

  // 统一处理客户端事件（双人/三人共用），返回 ack 给发起方
  handleClientEmit(clientId, event, payload = {}) {
    this.addClient(clientId);
    try {
      switch (event) {
        case 'enter_lobby':
          this.lobby.add(clientId);
          this.send(clientId, 'rooms_update', this.getJoinableRooms());
          return { ok: true };

        case 'exit_lobby':
          this.lobby.delete(clientId);
          return { ok: true };

        case 'create_room': {
          const mode = VALID_MODES.includes(payload?.mode) ? payload.mode : 'chaos';
          this.ensureLeftPreviousRoom(clientId);
          let roomId = generateRoomId();
          while (this.rooms.has(roomId)) roomId = generateRoomId();
          const SessionCls = (mode === 'three-open' || mode === 'three-dark') ? ThreeGameSession : GameSession;
          const session = new SessionCls(roomId, mode);
          this.rooms.set(roomId, session);
          this.clientRooms.set(clientId, { roomId, color: null });
          this.lobby.delete(clientId);
          this.broadcastRoomsUpdate();
          const colors = seatsOf(session);
          return { ok: true, roomId, mode: session.mode, taken: [], seats: colors };
        }

        case 'join_room': {
          const roomId = payload?.roomId;
          if (!isValidRoomId(roomId)) return { ok: false, error: 'Invalid room id' };
          const session = this.rooms.get(roomId);
          if (!session) return { ok: false, error: 'Room not found' };
          if (session.status === 'finished') return { ok: false, error: 'Game already finished' };
          const colors = seatsOf(session);
          if (colors.every((c) => session.players[c])) return { ok: false, error: 'Room is full' };
          this.ensureLeftPreviousRoom(clientId);
          this.clientRooms.set(clientId, { roomId, color: null });
          this.lobby.delete(clientId);
          const taken = colors.filter((c) => session.players[c]);
          return { ok: true, roomId, mode: session.mode, taken, seats: colors };
        }

        case 'select_color': {
          const info = this.clientRooms.get(clientId);
          const roomId = payload?.roomId;
          const color = payload?.color;
          if (!info || info.roomId !== roomId) return { ok: false, error: 'Join the room first' };
          const session = this.rooms.get(roomId);
          if (!session) return { ok: false, error: 'Room not found' };
          if (!seatsOf(session).includes(color)) return { ok: false, error: 'Invalid color' };
          if (info.color) return { ok: false, error: 'Already seated' };
          if (session.players[color] && session.players[color] !== clientId) {
            return { ok: false, error: 'Color taken' };
          }

          session.addPlayer(clientId, color);
          info.color = color;

          this.send(clientId, 'game_state', session.getPublicState(color));
          this.broadcastRoomsUpdate();

          const colors = seatsOf(session);
          if (session.status === 'playing') {
            for (const c of colors) {
              if (c === color) continue;
              const cid = session.players[c];
              if (cid) this.send(cid, 'game_state', session.getPublicState(c));
            }
            for (const recipient of colors.map((c) => session.players[c]).filter(Boolean)) {
              this.send(recipient, 'game_status', session.getStatus());
            }
          } else {
            const otherClient = colors.map((c) => session.players[c]).find((id) => id && id !== clientId);
            if (otherClient) this.send(otherClient, 'opponent_joined', { color });
          }
          return { ok: true, color };
        }

        // 走法查询（双人/三人统一）
        case 'get_valid_moves':
        case 'get_three_moves': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, moves: [] };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, moves: [] };
          if (isThreeSession(session)) {
            return { ok: true, moves: session.getValidMovesForPlayer(payload?.key, info.color) };
          }
          return { ok: true, moves: session.getValidMovesForPlayer(payload?.row, payload?.col, info.color) };
        }

        // 走子（双人/三人统一）
        case 'make_move':
        case 'make_three_move': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, error: 'Not in a game' };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, error: 'Room not found' };

          let result;
          if (isThreeSession(session)) {
            result = session.tryMove(payload?.fromKey, payload?.toKey, info.color);
          } else {
            result = session.tryMove(payload?.fromRow, payload?.fromCol, payload?.toRow, payload?.toCol, info.color);
          }
          if (!result.ok) return { ok: false, error: result.error };

          const colors = seatsOf(session);
          for (const recipient of colors.map((c) => session.players[c]).filter(Boolean)) {
            this.send(recipient, 'move_made', { move: result.move, currentTurn: result.currentTurn });
          }
          this.emitSessionState(info.roomId, session);
          if (result.gameOver) {
            for (const recipient of colors.map((c) => session.players[c]).filter(Boolean)) {
              this.send(recipient, 'game_over', { winner: result.winner, reason: result.reason });
            }
          }
          return { ok: true };
        }

        // 翻面（双人/三人统一）
        case 'flip_piece':
        case 'flip_three_piece': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, error: 'Not in a game' };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, error: 'Room not found' };

          const result = isThreeSession(session)
            ? session.flipPiece(payload?.key, info.color)
            : session.flipPiece(payload?.row, payload?.col, info.color);
          if (!result.ok) return { ok: false, error: result.error };

          const colors = seatsOf(session);
          for (const recipient of colors.map((c) => session.players[c]).filter(Boolean)) {
            this.send(recipient, 'move_made', { move: result.move, currentTurn: result.currentTurn });
          }
          this.emitSessionState(info.roomId, session);
          return { ok: true };
        }

        case 'get_game_state': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, error: 'Not in a game' };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, error: 'Room not found' };
          this.send(clientId, 'game_state', session.getPublicState(info.color));
          return { ok: true };
        }

        case 'get_traditional_type':
          return { ok: true, type: findTraditionalType(payload?.row, payload?.col) };

        case 'request_rematch': {
          const info = this.clientRooms.get(clientId);
          const roomId = payload?.roomId || info?.roomId;
          if (!roomId) return { ok: false, error: 'Not in a room' };
          const session = this.rooms.get(roomId);
          if (!session) return { ok: false, error: 'Room not found' };
          const color = info?.color;
          if (!color || !session.players[color]) return { ok: false, error: 'Not in this game' };

          const res = session.requestRematch(color);
          if (!res.ok) return { ok: false, error: res.error };

          const colors = seatsOf(session);
          for (const c of colors) {
            if (c === color) continue;
            const cid = session.players[c];
            if (cid) this.send(cid, 'rematch_update', { who: color, ready: res.ready });
          }

          if (res.ready) {
            session.resetForRematch();
            this.emitSessionState(roomId, session);
            for (const recipient of colors.map((c) => session.players[c]).filter(Boolean)) {
              this.send(recipient, 'rematch_started', {});
            }
            return { ok: true, ready: true };
          }
          return { ok: true, ready: false };
        }

        case 'leave_room':
          this.leaveRoom(clientId);
          return { ok: true };

        default:
          return { ok: false, error: `Unknown event: ${event}` };
      }
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
}
