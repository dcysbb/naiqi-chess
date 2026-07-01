import { GameSession } from './game/session.js';
import { findTraditionalType } from './game/moves.js';

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
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

  emitSessionState(roomId, session) {
    const redClient = session.players.red;
    const blackClient = session.players.black;
    if (redClient) this.send(redClient, 'game_state', session.getPublicState('red'));
    if (blackClient) this.send(blackClient, 'game_state', session.getPublicState('black'));
    for (const clientId of [redClient, blackClient]) {
      if (clientId) this.send(clientId, 'game_status', session.getStatus());
    }
  }

  getJoinableRooms() {
    const list = [];
    for (const [roomId, session] of this.rooms.entries()) {
      if (!session.isJoinable()) continue;
      const taken = [];
      if (session.players.red) taken.push('red');
      if (session.players.black) taken.push('black');
      list.push({ roomId, mode: session.mode, taken, seatsTaken: taken.length });
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

  leaveRoom(clientId) {
    const info = this.clientRooms.get(clientId);
    this.lobby.delete(clientId);
    if (info?.roomId) {
      const session = this.rooms.get(info.roomId);
      if (session && info.color) {
        session.removePlayer(clientId);
        const remainingClient = session.players.red || session.players.black;
        if (remainingClient) {
          this.send(remainingClient, 'opponent_left', {});
          this.send(remainingClient, 'game_state', session.getPublicState(
            session.players.red ? 'red' : 'black',
          ));
        }
        if (!session.players.red && !session.players.black) {
          this.rooms.delete(info.roomId);
        }
      }
      this.broadcastRoomsUpdate();
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
        const recipients = [session.players.red, session.players.black].filter(Boolean);
        for (const recipient of recipients) {
          this.send(recipient, 'opponent_disconnected', { clientId });
          this.send(recipient, 'game_over', { winner: session.winner, reason: 'opponent_disconnected' });
        }
        if (!session.players.red && !session.players.black) this.rooms.delete(info.roomId);
      }
      this.broadcastRoomsUpdate();
    }
    this.clientRooms.delete(clientId);
  }

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
          let roomId = generateRoomId();
          while (this.rooms.has(roomId)) roomId = generateRoomId();
          const session = new GameSession(roomId, payload?.mode);
          this.rooms.set(roomId, session);
          this.clientRooms.set(clientId, { roomId, color: null });
          this.lobby.delete(clientId);
          this.broadcastRoomsUpdate();
          return { ok: true, roomId, mode: session.mode, taken: [] };
        }

        case 'join_room': {
          const session = this.rooms.get(payload?.roomId);
          if (!session) return { ok: false, error: 'Room not found' };
          if (session.players.red && session.players.black) {
            return { ok: false, error: 'Room is full' };
          }
          this.clientRooms.set(clientId, { roomId: payload.roomId, color: null });
          this.lobby.delete(clientId);
          const taken = [];
          if (session.players.red) taken.push('red');
          if (session.players.black) taken.push('black');
          return { ok: true, roomId: payload.roomId, mode: session.mode, taken };
        }

        case 'select_color': {
          const session = this.rooms.get(payload?.roomId);
          if (!session) return { ok: false, error: 'Room not found' };
          if (session.players[payload.color]) return { ok: false, error: 'Color taken' };

          session.addPlayer(clientId, payload.color);
          const existing = this.clientRooms.get(clientId);
          if (existing) existing.color = payload.color;

          this.send(clientId, 'game_state', session.getPublicState(payload.color));
          this.broadcastRoomsUpdate();

          if (session.status === 'playing') {
            const oppColor = payload.color === 'red' ? 'black' : 'red';
            const oppClientId = session.players[oppColor];
            if (oppClientId) this.send(oppClientId, 'game_state', session.getPublicState(oppColor));
            for (const recipient of [session.players.red, session.players.black].filter(Boolean)) {
              this.send(recipient, 'game_status', session.getStatus());
            }
          } else {
            const otherClient = Object.values(session.players).find((id) => id && id !== clientId);
            if (otherClient) this.send(otherClient, 'opponent_joined', { color: payload.color });
          }
          return { ok: true, color: payload.color };
        }

        case 'get_valid_moves': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, moves: [] };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, moves: [] };
          return { ok: true, moves: session.getValidMovesForPlayer(payload.row, payload.col, info.color) };
        }

        case 'make_move': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, error: 'Not in a game' };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, error: 'Room not found' };

          const result = session.tryMove(payload.fromRow, payload.fromCol, payload.toRow, payload.toCol, info.color);
          if (!result.ok) return { ok: false, error: result.error };

          for (const recipient of [session.players.red, session.players.black].filter(Boolean)) {
            this.send(recipient, 'move_made', { move: result.move, currentTurn: result.currentTurn });
          }
          this.emitSessionState(info.roomId, session);
          if (result.gameOver) {
            for (const recipient of [session.players.red, session.players.black].filter(Boolean)) {
              this.send(recipient, 'game_over', { winner: result.winner, reason: result.reason });
            }
          }
          return { ok: true };
        }

        case 'flip_piece': {
          const info = this.clientRooms.get(clientId);
          if (!info?.roomId || !info.color) return { ok: false, error: 'Not in a game' };
          const session = this.rooms.get(info.roomId);
          if (!session) return { ok: false, error: 'Room not found' };

          const result = session.flipPiece(payload.row, payload.col, info.color);
          if (!result.ok) return { ok: false, error: result.error };

          for (const recipient of [session.players.red, session.players.black].filter(Boolean)) {
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
          return { ok: true, type: findTraditionalType(payload.row, payload.col) };

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

          const opponentColor = color === 'red' ? 'black' : 'red';
          const oppClientId = session.players[opponentColor];
          if (oppClientId) this.send(oppClientId, 'rematch_update', { who: color, ready: res.ready });

          if (res.ready) {
            session.resetForRematch();
            this.emitSessionState(roomId, session);
            for (const recipient of [session.players.red, session.players.black].filter(Boolean)) {
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
