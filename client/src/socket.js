import { io } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import { LocalGameServer } from './localGameServer.js';
import { MobileHost, hasMobileHostPlugin } from './mobileHost.js';

const isLocalDev = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

// Capacitor (Android) serves the app from a synthetic local origin and exposes
// window.Capacitor. It does not have a Node/socket.io server unless we start the
// lightweight native mobile-host bridge below.
export const isCapacitor = typeof window !== 'undefined'
  && (Capacitor.isNativePlatform?.() === true
    || Capacitor.getPlatform?.() !== 'web'
    || window.location.protocol === 'capacitor:');

const isPackagedDesktop = window.location.protocol === 'file:';
const queryPort = new URLSearchParams(window.location.search).get('serverPort');

export const DEFAULT_URL = isPackagedDesktop
  ? `http://localhost:${queryPort || 3030}`
  : queryPort
    ? `http://localhost:${queryPort}`
    : isCapacitor
      ? null
      : isLocalDev
        ? 'http://localhost:3030'
        : window.location.origin;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  return url ? url.replace(/\/+$/, '') : url;
}

function callbackArgs(callback, timeoutMs, error, response) {
  if (!callback) return;
  if (timeoutMs) callback(error || null, response);
  else callback(error ? { ok: false, error: error.message || String(error) } : response);
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function isMobileHost(url) {
  try {
    const info = await fetchJson(`${normalizeUrl(url)}/__chess_info__`, { method: 'GET', timeoutMs: 1200 });
    return Boolean(info?.mobileHost);
  } catch (_) {
    return false;
  }
}

class HybridSocket {
  constructor() {
    this.listeners = new Map();
    this.transport = null;
    this.pendingTimeout = null;
  }

  get connected() {
    return Boolean(this.transport?.connected);
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    if (!this.listeners.has(event)) return this;
    if (handler) this.listeners.get(event).delete(handler);
    else this.listeners.delete(event);
    return this;
  }

  emit(event, ...args) {
    const timeoutMs = this.pendingTimeout;
    this.pendingTimeout = null;
    if (!this.transport) {
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      callbackArgs(callback, timeoutMs, new Error('No host selected'), null);
      return this;
    }
    this.transport.emit(event, args, timeoutMs);
    return this;
  }

  timeout(ms) {
    this.pendingTimeout = ms;
    return this;
  }

  connect() {
    return this.transport?.connect();
  }

  disconnect() {
    return this.transport?.disconnect();
  }

  setTransport(transport) {
    if (this.transport && this.transport !== transport) {
      this.transport.destroy?.();
    }
    this.transport = transport;
  }

  dispatch(event, ...args) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      handler(...args);
    }
  }
}

class SocketIoTransport {
  constructor(url, hub) {
    this.url = normalizeUrl(url);
    this.hub = hub;
    this.socket = io(this.url, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    this.socket.onAny((event, ...args) => this.hub.dispatch(event, ...args));
  }

  get connected() {
    return this.socket.connected;
  }

  connect() {
    this.socket.connect();
  }

  connectAndWait() {
    if (this.socket.connected) return Promise.resolve();
    this.socket.connect();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.off('connect', onOk);
        this.socket.off('connect_error', onErr);
      };
      const onOk = () => { cleanup(); resolve(); };
      const onErr = (err) => { cleanup(); reject(err); };
      this.socket.once('connect', onOk);
      this.socket.once('connect_error', onErr);
    });
  }

  emit(event, args, timeoutMs) {
    if (timeoutMs) this.socket.timeout(timeoutMs).emit(event, ...args);
    else this.socket.emit(event, ...args);
  }

  disconnect() {
    this.socket.disconnect();
  }

  destroy() {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

class LocalHostTransport {
  constructor(hub) {
    this.hub = hub;
    this.connected = false;
    this.server = null;
    this.listenerHandles = [];
    this.url = null;
    this.info = null;
  }

  async start() {
    if (!hasMobileHostPlugin()) throw new Error('Mobile host is only available in the Android app');

    this.listenerHandles = [
      await MobileHost.addListener('guestConnected', ({ connId }) => {
        this.server?.addClient(connId);
      }),
      await MobileHost.addListener('guestDisconnected', ({ connId }) => {
        this.server?.removeClient(connId);
      }),
      await MobileHost.addListener('guestEmit', async ({ connId, requestId, event, payload }) => {
        const response = this.server?.handleClientEmit(connId, event, payload || {}) || { ok: false, error: 'Host not ready' };
        await MobileHost.respond({ requestId, response });
      }),
    ];

    this.info = await MobileHost.start({ port: 3030, hostName: '奶棋手机' });
    this.url = this.info?.url || this.info?.urls?.[0] || `http://localhost:${this.info?.port || 3030}`;
    this.server = new LocalGameServer({
      hostName: this.info?.hostName || '奶棋手机',
      hostId: this.info?.hostId || 'mobile-host',
      onSend: (clientId, event, payload) => {
        if (clientId === 'local') {
          this.hub.dispatch(event, payload);
        } else {
          MobileHost.emitToGuest({ connId: clientId, event, payload });
        }
      },
      onRoomsChanged: (info) => {
        MobileHost.updateInfo({ openRooms: info.openRooms });
      },
    });
    await MobileHost.updateInfo({ openRooms: this.server.getJoinableRooms().length });
    return this.info;
  }

  connect() {
    if (!this.server) return;
    this.server.addClient('local');
    this.connected = true;
    this.hub.dispatch('connect');
  }

  emit(event, args, timeoutMs) {
    const last = args[args.length - 1];
    const callback = typeof last === 'function' ? last : null;
    const payload = callback ? args[0] : args[0];
    const response = this.server?.handleClientEmit('local', event, payload || {});
    callbackArgs(callback, timeoutMs, null, response);
  }

  disconnect() {
    if (this.connected) this.server?.removeClient('local');
    this.connected = false;
    this.hub.dispatch('disconnect');
  }

  async destroy() {
    this.disconnect();
    for (const handle of this.listenerHandles) {
      await handle?.remove?.();
    }
    this.listenerHandles = [];
    this.server = null;
    try {
      await MobileHost.stop();
    } catch (_) {
      // Ignore cleanup failures while switching transports.
    }
  }
}

class GuestHttpTransport {
  constructor(url, hub) {
    this.url = normalizeUrl(url);
    this.hub = hub;
    this.connId = null;
    this.connected = false;
    this.polling = false;
  }

  async connectAndWait() {
    const res = await fetchJson(`${this.url}/__mobile_host__/guest/connect`, {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 5000,
    });
    if (!res?.ok || !res.connId) throw new Error(res?.error || 'Unable to connect mobile host');
    this.connId = res.connId;
    this.connected = true;
    this.hub.dispatch('connect');
    this.startPolling();
  }

  connect() {
    this.connectAndWait().catch((error) => this.hub.dispatch('connect_error', error));
  }

  async emit(event, args, timeoutMs) {
    const last = args[args.length - 1];
    const callback = typeof last === 'function' ? last : null;
    const payload = callback ? args[0] : args[0];
    try {
      const res = await fetchJson(`${this.url}/__mobile_host__/guest/emit`, {
        method: 'POST',
        body: JSON.stringify({ connId: this.connId, event, payload: payload || {} }),
        timeoutMs: timeoutMs || 8000,
      });
      if (!res?.ok) throw new Error(res?.error || 'Host rejected request');
      callbackArgs(callback, timeoutMs, null, res.response);
    } catch (error) {
      callbackArgs(callback, timeoutMs, error, null);
    }
  }

  async startPolling() {
    if (this.polling) return;
    this.polling = true;
    while (this.connected) {
      try {
        const res = await fetchJson(`${this.url}/__mobile_host__/guest/poll`, {
          method: 'POST',
          body: JSON.stringify({ connId: this.connId }),
          timeoutMs: 25000,
        });
        for (const item of res?.events || []) {
          this.hub.dispatch(item.event, item.payload);
        }
      } catch (_) {
        await sleep(700);
      }
    }
    this.polling = false;
  }

  async disconnect() {
    const connId = this.connId;
    this.connected = false;
    this.connId = null;
    if (connId) {
      try {
        await fetchJson(`${this.url}/__mobile_host__/guest/disconnect`, {
          method: 'POST',
          body: JSON.stringify({ connId }),
          timeoutMs: 1200,
        });
      } catch (_) {
        // The host may already be gone.
      }
    }
    this.hub.dispatch('disconnect');
  }

  destroy() {
    this.disconnect();
  }
}

export const socket = new HybridSocket();

let currentUrl = DEFAULT_URL;

if (DEFAULT_URL) {
  socket.setTransport(new SocketIoTransport(DEFAULT_URL, socket));
}

export async function connectTo(url) {
  const target = normalizeUrl(url || DEFAULT_URL);
  if (!target) throw new Error('No host selected');
  if (target === currentUrl && socket.connected) return;

  const transport = await isMobileHost(target)
    ? new GuestHttpTransport(target, socket)
    : new SocketIoTransport(target, socket);

  socket.setTransport(transport);
  currentUrl = target;
  await transport.connectAndWait();
}

export async function startMobileHost() {
  const transport = new LocalHostTransport(socket);
  await transport.start();
  socket.setTransport(transport);
  currentUrl = transport.url;
  transport.connect();
  return transport.info;
}

export function getCurrentUrl() {
  return currentUrl;
}
