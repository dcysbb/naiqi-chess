// LAN host discovery. Two strategies depending on platform:
//   1. Desktop (Electron): mDNS via the preload bridge (window.chessDiscovery).
//      Fast and reliable, discovers other desktop hosts on the LAN.
//   2. Web / mobile / Capacitor: no mDNS available in the browser, so we scan
//      the local subnet by fetching /__chess_info__ on candidate hosts.

/**
 * @typedef {Object} DiscoveredHost
 * @property {string} url      - e.g. "http://192.168.1.5:3030"
 * @property {string} hostName - friendly name
 * @property {string} hostId   - stable id for de-dup
 * @property {number} [openRooms]
 */

// --- Strategy 1: mDNS via Electron preload bridge ---
function watchMdns(onHost, onLost) {
  const bridge = window.chessDiscovery;
  if (!bridge || typeof bridge.start !== 'function') return false;

  bridge.start((host) => onHost(normalizeMdns(host)), (hostId) => onLost && onLost(hostId));
  return true;
}

function normalizeMdns(raw) {
  return {
    url: `http://${raw.address}:${raw.port}`,
    hostName: raw.hostName || raw.name || raw.address,
    hostId: raw.hostId || raw.name || raw.address,
    openRooms: raw.openRooms,
  };
}

// --- Strategy 2: subnet IP scan (browser / mobile) ---
const SCAN_TIMEOUT = 1200; // ms per probe

function candidateSubnets() {
  // We can't read the local IP from a browser. The pragmatic approach: probe
  // the most common home/LAN subnets on the last octet 1..254. Most home
  // routers hand out IPs in 192.168.x. or 10.0.0.x ranges. This is best-effort.
  const bases = [
    '192.168.0',
    '192.168.1',
    '192.168.2',
    '192.168.3',
    '10.0.0',
    '10.0.1',
  ];
  const octets = [];
  for (let i = 1; i <= 254; i++) octets.push(i);
  const out = [];
  for (const base of bases) for (const o of octets) out.push(`${base}.${o}`);
  return out;
}

async function probeHost(ip, port) {
  const url = `http://${ip}:${port}/__chess_info__`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SCAN_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    if (!res.ok) return null;
    const info = await res.json();
    if (!info || info.service !== 'chess') return null;
    return {
      url: `http://${ip}:${port}`,
      hostName: info.hostName || ip,
      hostId: info.hostId || ip,
      openRooms: info.openRooms,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function scanSubnet(port, onFound, concurrency = 40) {
  const ips = candidateSubnets();
  let cursor = 0;
  async function worker() {
    while (cursor < ips.length) {
      const ip = ips[cursor++];
      const host = await probeHost(ip, port);
      if (host) onFound(host);
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
}

/**
 * Begin discovery. Calls onHost for each host found (de-duplicated by hostId),
 * and returns a stop() function. Always succeeds (falls back to IP scan).
 *
 * @param {(host: DiscoveredHost) => void} onHost
 * @param {object} [opts]
 * @param {number} [opts.port=3030]
 * @returns {{ stop: () => void }}
 */
export function startDiscovery(onHost, opts = {}) {
  const port = opts.port || 3030;
  const seen = new Map(); // hostId -> host
  let stopped = false;
  let mdnsActive = false;

  function report(host) {
    if (stopped) return;
    if (!host || !host.hostId) return;
    if (seen.has(host.hostId)) {
      // Refresh openRooms count if known.
      const prev = seen.get(host.hostId);
      if (host.openRooms !== undefined) prev.openRooms = host.openRooms;
      onHost(prev);
      return;
    }
    seen.set(host.hostId, host);
    onHost(host);
  }

  // Try mDNS first (desktop). If unavailable, run the IP scan.
  mdnsActive = watchMdns(report, (hostId) => seen.delete(hostId));
  if (!mdnsActive) {
    // Browser/mobile: run a one-shot subnet scan. Cheap to re-run periodically.
    scanSubnet(port, report).catch(() => {});
    const interval = setInterval(() => {
      if (stopped) return;
      scanSubnet(port, report).catch(() => {});
    }, 8000);
    // store for stop()
    stopFns.push(() => clearInterval(interval));
  }

  const stopFns = [];
  stopFns.push(() => {
    stopped = true;
    const bridge = window.chessDiscovery;
    if (bridge && typeof bridge.stop === 'function') bridge.stop();
  });

  return () => stopFns.forEach((fn) => fn());
}
