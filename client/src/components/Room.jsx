import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket, connectTo, getCurrentUrl, DEFAULT_URL, isCapacitor, startMobileHost } from '../socket.js';
import { startDiscovery } from '../discovery.js';

const TWO_SEATS = ['red', 'black'];
const SEAT_LABELS = {
  red: '红', black: '黑',
  wei: '魏', shu: '蜀', wu: '吴',
};
const SEAT_COLORS = {
  red: '#e74c3c', black: '#2c3e50',
  wei: '#c0392b', shu: '#2c3e50', wu: '#27ae60',
};

function seatsForMode(mode) {
  if (mode === 'three-open' || mode === 'three-dark') return ['wei', 'shu', 'wu'];
  return TWO_SEATS;
}

const MODES = [
  { id: 'chaos', label: '暗棋象棋', note: '传统象棋棋盘，暗子按所在位置走', seats: 2 },
  { id: 'dark', label: '正常暗棋', note: '4x8 翻翻棋，翻子、走一格、炮隔子吃', seats: 2 },
  { id: 'three-open', label: '三人明棋', note: '魏蜀吴三分天下，明棋对战', seats: 3 },
  { id: 'three-dark', label: '三人暗棋', note: '魏蜀吴三分天下，暗子翻面', seats: 3 },
];

function modeLabelOf(mode) {
  return MODES.find((m) => m.id === mode)?.label || '奶棋';
}

function shortUrl(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '');
}

function manualHostUrl(input) {
  const host = input.trim();
  if (!host) return '';
  if (/^https?:\/\//i.test(host)) return host;
  if (/:\d+$/.test(host)) return `http://${host}`;
  return `http://${host}:3030`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
}

export default function Room({
  onRoomCreated,
  onRoomJoined,
  onColorSelected,
  onRoomCancelled,
  copyFeedback,
  onCopyRoom,
}) {
  const [step, setStep] = useState('choose');
  const [gameMode, setGameMode] = useState('chaos');
  const [roomId, setRoomId] = useState(null);
  const [availableColors, setAvailableColors] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [hosts, setHosts] = useState([]);
  const [connectingHost, setConnectingHost] = useState(null);
  const [manualIp, setManualIp] = useState('');
  const [scanning, setScanning] = useState(false);
  const [hostInfo, setHostInfo] = useState(null);
  const [hostAddressCopied, setHostAddressCopied] = useState(false);
  const stopDiscoveryRef = useRef(null);
  const hostsRef = useRef(new Map());
  const stepRef = useRef(step);
  const selectColorHistoryPushedRef = useRef(false);

  useEffect(() => {
    stepRef.current = step;
    if (step === 'select_color' && !selectColorHistoryPushedRef.current) {
      window.history.pushState({ chessView: 'select_color' }, '');
      selectColorHistoryPushedRef.current = true;
    }
    if (step === 'choose') {
      selectColorHistoryPushedRef.current = false;
    }
  }, [step]);

  // Subscribe to lobby updates while on the choose screen.
  const enterLobby = useCallback(() => {
    socket.emit('enter_lobby');
  }, []);

  const exitLobby = useCallback(() => {
    socket.emit('exit_lobby');
  }, []);

  useEffect(() => {
    const onRoomsUpdate = (list) => setRooms(list || []);
    socket.on('rooms_update', onRoomsUpdate);
    return () => socket.off('rooms_update', onRoomsUpdate);
  }, []);

  // Enter lobby whenever we show the choose screen; leave it otherwise.
  useEffect(() => {
    if (step === 'choose') enterLobby();
    else exitLobby();
    return () => {};
  }, [step, enterLobby, exitLobby]);

  // LAN host discovery: runs while on the 'choose' screen.
  const upsertHost = useCallback((host) => {
    if (DEFAULT_URL && host.url?.replace(/\/+$/, '') === DEFAULT_URL.replace(/\/+$/, '')) return;
    hostsRef.current.set(host.hostId, host);
    setHosts(Array.from(hostsRef.current.values()));
  }, []);

  const loadHostInfo = useCallback(async (url) => {
    if (!url) return;
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/__chess_info__`);
      if (!response.ok) return;
      const info = await response.json();
      if (info?.service === 'chess') setHostInfo(info);
    } catch (_) {
      // Discovery and socket connection show their own errors when needed.
    }
  }, []);

  useEffect(() => {
    loadHostInfo(getCurrentUrl() || DEFAULT_URL);
  }, [loadHostInfo]);

  useEffect(() => {
    if (step !== 'choose') return undefined;
    const stop = startDiscovery((host) => {
      upsertHost(host);
    }, { onScanStateChange: setScanning });
    stopDiscoveryRef.current = stop;
    return () => {
      stop();
      stopDiscoveryRef.current = null;
    };
  }, [step, upsertHost]);

  const handleConnectHost = useCallback(async (url) => {
    setConnectingHost(url);
    setError('');
    try {
      await connectTo(url);
      await loadHostInfo(url);
      // After connecting, ask for the room list from this host.
      socket.emit('enter_lobby');
      setStep('choose'); // refresh room list for the new host
    } catch (e) {
      setError('无法连接到该主机，请确认在同一局域网且主机已运行');
    } finally {
      setConnectingHost(null);
    }
  }, [loadHostInfo]);

  const handleCopyHostAddress = useCallback(async () => {
    const url = hostInfo?.urls?.[0];
    if (!url) return;
    await copyText(url);
    setHostAddressCopied(true);
    window.setTimeout(() => setHostAddressCopied(false), 1600);
  }, [hostInfo]);

  const handleManualConnect = useCallback(() => {
    const ip = manualIp.trim();
    if (!ip) {
      setError('请输入主机 IP，例如 192.168.1.5');
      return;
    }
    const url = manualHostUrl(ip);
    handleConnectHost(url);
  }, [manualIp, handleConnectHost]);

  const handleCreate = async () => {
    setError('');
    if (!socket.connected) {
      const target = getCurrentUrl() || DEFAULT_URL;
      if (!target) {
        if (!isCapacitor) {
          setError('请先连接局域网主机，再创建房间');
          return;
        }
        try {
          await startMobileHost();
        } catch (e) {
          setError('无法启动手机主机，请确认当前是 Android App 并已连接 Wi-Fi 或热点');
          return;
        }
      } else {
        try {
          await connectTo(target);
        } catch (e) {
          setError('无法连接主机，请确认主机服务正在运行');
          return;
        }
      }
    }

    socket.timeout(5000).emit('create_room', { mode: gameMode }, (err, res) => {
      if (err) {
        setError('创建房间超时，请检查主机连接');
        return;
      }
      if (res?.ok) {
        setRoomId(res.roomId);
        setGameMode(res.mode);
        onRoomCreated(res.roomId);
        const seats = (res.seats && res.seats.length) ? res.seats : seatsForMode(res.mode);
        setAvailableColors(seats.filter((c) => !(res.taken || []).includes(c)));
        setStep('select_color');
      } else {
        setError(res.error || '创建房间失败');
      }
    });
  };

  const handleJoinRoom = (targetRoomId, taken, mode) => {
    setError('');
    socket.emit('join_room', { roomId: targetRoomId }, (res) => {
      if (res.ok) {
        setRoomId(res.roomId);
        setGameMode(res.mode);
        onRoomJoined(res.roomId);
        const seats = (res.seats && res.seats.length) ? res.seats : seatsForMode(res.mode || mode);
        setAvailableColors(seats.filter((c) => !(res.taken || taken || []).includes(c)));
        setStep('select_color');
      } else {
        setError(res.error || '加入房间失败');
      }
    });
  };

  const handleSelectColor = (color) => {
    if (!roomId) return;
    setError('');
    socket.emit('select_color', { roomId, color }, (res) => {
      if (res.ok) {
        onColorSelected(color);
      } else {
        setError(res.error || '选择阵营失败');
      }
    });
  };

  const handleBackToChoose = useCallback((fromHistory = false) => {
    const shouldPopHistory = selectColorHistoryPushedRef.current && window.history.length > 1;
    stepRef.current = 'choose';
    selectColorHistoryPushedRef.current = false;
    socket.emit('leave_room');
    setStep('choose');
    setRoomId(null);
    setAvailableColors([]);
    setError('');
    onRoomCancelled?.();
    if (!fromHistory && shouldPopHistory) {
      window.history.back();
    }
  }, [onRoomCancelled]);

  useEffect(() => {
    const onPopState = () => {
      if (stepRef.current === 'select_color') handleBackToChoose(true);
    };
    const onKeyDown = (event) => {
      const wantsBack = event.key === 'Escape'
        || event.key === 'BrowserBack'
        || (event.altKey && event.key === 'ArrowLeft');
      if (!wantsBack || stepRef.current !== 'select_color') return;
      event.preventDefault();
      handleBackToChoose();
    };
    const onNativeBack = () => {
      if (stepRef.current === 'select_color') handleBackToChoose(true);
    };

    window.__chessHandleRoomBack = () => {
      if (stepRef.current !== 'select_color') return false;
      handleBackToChoose(true);
      return true;
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('native-back', onNativeBack);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('native-back', onNativeBack);
      if (window.__chessHandleRoomBack) delete window.__chessHandleRoomBack;
    };
  }, [handleBackToChoose]);

  useEffect(() => {
    const handler = ({ color }) => {
      setAvailableColors((prev) => prev.filter((c) => c !== color));
    };
    socket.on('opponent_joined', handler);
    return () => socket.off('opponent_joined', handler);
  }, []);

  const btnStyle = (bg) => ({
    padding: '12px 28px',
    fontSize: '16px',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    background: bg,
    color: '#fff',
    fontWeight: 'bold',
  });

  const modeButtonStyle = (active) => ({
    padding: '10px 12px',
    borderRadius: '8px',
    border: active ? '2px solid #f1c40f' : '1px solid rgba(255,255,255,0.18)',
    background: active ? 'rgba(241,196,15,0.16)' : 'rgba(0,0,0,0.22)',
    color: '#fff',
    cursor: 'pointer',
    textAlign: 'left',
    flex: '1 1 180px',
  });

  const seatTag = (taken, color, label) => (
    <span style={{
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      fontWeight: 'bold',
      marginRight: '6px',
      background: taken.includes(color) ? 'rgba(231,76,60,0.25)' : 'rgba(46,204,113,0.18)',
      color: taken.includes(color) ? '#e74c3c' : '#2ecc71',
      border: `1px solid ${taken.includes(color) ? 'rgba(231,76,60,0.4)' : 'rgba(46,204,113,0.4)'}`,
    }}>
      {label} {taken.includes(color) ? '已占' : '空'}
    </span>
  );

  if (step === 'choose') {
    return (
      <div className="room-card">
        <div className="room-card-header">
          <h2 style={{ margin: 0 }}>开始游戏</h2>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              style={modeButtonStyle(gameMode === mode.id)}
              onClick={() => setGameMode(mode.id)}
            >
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>{mode.label}</div>
              <div style={{ fontSize: '12px', opacity: 0.72, lineHeight: 1.35 }}>{mode.note}</div>
            </button>
          ))}
        </div>

        <button style={btnStyle('#e74c3c')} onClick={handleCreate}>创建房间</button>

        {hostInfo?.urls?.length > 0 && (
          <div style={{
            marginTop: '16px', padding: '10px 12px', textAlign: 'left',
            border: '1px solid rgba(46,204,113,0.38)', borderRadius: '8px',
            background: 'rgba(46,204,113,0.1)',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#7ee2a8' }}>Web 局域网主机已就绪</div>
            <div style={{ fontSize: '12px', opacity: 0.78, marginTop: '4px', overflowWrap: 'anywhere' }}>
              同一 Wi-Fi / 热点设备打开 {hostInfo.urls[0]}
            </div>
            <button
              type="button"
              onClick={handleCopyHostAddress}
              style={{
                marginTop: '8px', padding: '6px 10px', border: 'none', borderRadius: '6px',
                background: hostAddressCopied ? '#27ae60' : '#3498db', color: '#fff', cursor: 'pointer',
              }}
            >
              {hostAddressCopied ? '已复制' : '复制访问地址'}
            </button>
          </div>
        )}

        {/* LAN host switcher (mobile/web clients join a desktop host on the LAN). */}
        <div style={{ marginTop: '18px', textAlign: 'left' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '8px',
          }}>
            <h3 style={{ margin: 0, fontSize: '14px' }}>局域网主机</h3>
            <span style={{ fontSize: '11px', opacity: 0.6 }}>
              {scanning ? '扫描中…' : ''} 当前：{shortUrl(getCurrentUrl())}
            </span>
          </div>

          {/* The local/own host (only when this client has its own server, i.e. desktop). */}
          {DEFAULT_URL && (
            <button
              onClick={() => handleConnectHost(DEFAULT_URL)}
              disabled={connectingHost === DEFAULT_URL}
              style={{
                width: '100%', textAlign: 'left', marginBottom: '6px',
                padding: '8px 12px', borderRadius: '8px',
                border: getCurrentUrl() === DEFAULT_URL ? '1px solid #2ecc71' : '1px solid rgba(255,255,255,0.15)',
                background: getCurrentUrl() === DEFAULT_URL ? 'rgba(46,204,113,0.12)' : 'rgba(0,0,0,0.25)',
                color: '#fff', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '13px' }}>当前 Web 主机 {getCurrentUrl() === DEFAULT_URL ? '✓' : ''}</div>
              <div style={{ fontSize: '11px', opacity: 0.6 }}>{shortUrl(DEFAULT_URL)}（此页面连接的服务器）</div>
            </button>
          )}

          {/* On mobile there's no local host — show a hint instead. */}
          {!DEFAULT_URL && (
            <div style={{
              fontSize: '11px', opacity: 0.6, marginBottom: '6px',
              padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px',
            }}>
              手机端可直接创建房间，也可加入同一 Wi-Fi / 热点内的桌面或手机主机。
            </div>
          )}

          {/* Discovered remote hosts */}
          {hosts.map((h) => (
            <button
              key={h.hostId}
              onClick={() => handleConnectHost(h.url)}
              disabled={connectingHost === h.url}
              style={{
                width: '100%', textAlign: 'left', marginBottom: '6px',
                padding: '8px 12px', borderRadius: '8px',
                border: getCurrentUrl() === h.url ? '1px solid #2ecc71' : '1px solid rgba(255,255,255,0.15)',
                background: getCurrentUrl() === h.url ? 'rgba(46,204,113,0.12)' : 'rgba(0,0,0,0.25)',
                color: '#fff', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '13px' }}>
                {h.hostName} {getCurrentUrl() === h.url ? '✓' : ''}
              </div>
              <div style={{ fontSize: '11px', opacity: 0.6 }}>
                {shortUrl(h.url)}{h.mobileHost ? ' · 手机主机' : ''}{h.openRooms !== undefined ? ` · 开放房间 ${h.openRooms}` : ''}
              </div>
            </button>
          ))}

          {/* Manual IP fallback */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <input
              value={manualIp}
              onChange={(e) => setManualIp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleManualConnect(); }}
              placeholder="手动输入主机 IP，如 192.168.1.5"
              style={{
                flex: 1, padding: '8px 10px', fontSize: '13px',
                borderRadius: '6px', border: '1px solid rgba(255,255,255,0.18)',
                background: 'rgba(0,0,0,0.3)', color: '#fff',
              }}
            />
            <button
              onClick={handleManualConnect}
              style={{
                padding: '8px 14px', fontSize: '13px', border: 'none', borderRadius: '6px',
                background: '#3498db', color: '#fff', cursor: 'pointer',
              }}
            >连接</button>
          </div>
        </div>

        <div style={{ marginTop: '22px', textAlign: 'left' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '10px',
          }}>
            <h3 style={{ margin: 0, fontSize: '15px' }}>可加入的房间</h3>
            <span style={{ fontSize: '11px', opacity: 0.5 }}>{rooms.length} 个</span>
          </div>

          {rooms.length === 0 ? (
            <div style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: '#aaa',
              fontSize: '13px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '8px',
              border: '1px dashed rgba(255,255,255,0.12)',
            }}>
              暂时没有可加入的房间，创建一个等对手吧
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
              {rooms.map((r) => {
                const seats = (r.seats && r.seats.length) ? r.seats : seatsForMode(r.mode);
                return (
                  <button
                    key={r.roomId}
                    onClick={() => handleJoinRoom(r.roomId, r.taken, r.mode)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(0,0,0,0.25)',
                      color: '#fff',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, letterSpacing: '2px' }}>{r.roomId}</div>
                      <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '2px' }}>{modeLabelOf(r.mode)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ marginBottom: '4px' }}>
                        {seats.map((c) => seatTag(r.taken, c, SEAT_LABELS[c] || c))}
                      </div>
                      <span style={{ fontSize: '12px', color: '#3498db' }}>加入 ›</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p style={{ color: '#e74c3c', marginTop: '12px' }}>{error}</p>}
      </div>
    );
  }

  if (step === 'select_color') {
    const modeLabel = modeLabelOf(gameMode);
    return (
      <div className="room-card">
        <div className="room-card-header">
          <button
            type="button"
            className="icon-button room-card-back"
            onClick={() => handleBackToChoose()}
            title="返回"
            aria-label="返回"
          >
            ‹
          </button>
          <h2 style={{ margin: 0 }}>房间号：{roomId}</h2>
        </div>
        <div style={{ marginBottom: '10px', opacity: 0.72, fontSize: '13px' }}>{modeLabel}</div>
        <button
          onClick={onCopyRoom}
          style={{
            ...btnStyle(copyFeedback ? '#27ae60' : 'rgba(255,255,255,0.15)'),
            marginBottom: '20px',
            padding: '8px 20px',
            fontSize: '13px',
          }}
        >
          {copyFeedback ? '已复制' : '复制房间号'}
        </button>
        <p style={{ opacity: 0.7, fontSize: '14px' }}>选择你的阵营：</p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
          {seatsForMode(gameMode).map((c) => {
            const label = SEAT_LABELS[c] || c;
            if (availableColors.includes(c)) {
              return (
                <button
                  key={c}
                  style={{ ...btnStyle(SEAT_COLORS[c] || '#34495e'), fontSize: '18px' }}
                  onClick={() => handleSelectColor(c)}
                >
                  {label}方
                </button>
              );
            }
            return (
              <span key={c} style={{ color: '#888', alignSelf: 'center' }}>{label}方已选</span>
            );
          })}
        </div>
        {error && <p style={{ color: '#e74c3c', marginTop: '12px' }}>{error}</p>}
        <p style={{ marginTop: '20px', fontSize: '12px', opacity: 0.5 }}>等待对手加入...</p>
      </div>
    );
  }

  return null;
}
