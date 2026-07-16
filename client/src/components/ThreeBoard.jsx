import React, { useRef, useEffect, useState, useCallback } from 'react';

const CELL = 54;
const MARGIN = 36;
const RADIUS = 22;

const PIECE_CHARS = {
  general: { wei: '帥', shu: '将', wu: '王' },
  advisor: { wei: '仕', shu: '士', wu: '士' },
  elephant: { wei: '相', shu: '象', wu: '象' },
  horse: { wei: '傌', shu: '馬', wu: '駒' },
  chariot: { wei: '俥', shu: '車', wu: '車' },
  cannon: { wei: '炮', shu: '砲', wu: '砲' },
  pawn: { wei: '兵', shu: '卒', wu: '卒' },
};

const FACTION_COLORS = { wei: '#c0392b', shu: '#2c3e50', wu: '#27ae60' };
const FACTION_LABELS = { wei: '魏', shu: '蜀', wu: '吴' };
const FACTION_ANGLES = { wei: 0, shu: 120, wu: 240 }; // 阵营朝向（度）
const ROWS = 6;
const COLS = 9;
const PALACE = { rowMin: 0, rowMax: 2, colMin: 3, colMax: 5 };

// 阵营局部坐标 → 旋转到画布
// 局部：原点在本阵后方中点(0,4)，x=col方向，y=row方向（朝中心）
// 阵营旋转角 = 阵营朝向；再整体旋转使"我方阵营"在底部。
function localToCanvas(faction, row, col, center, viewerFaction) {
  const lx = (col - 4) * CELL;
  const ly = row * CELL;
  const factionAngle = (FACTION_ANGLES[faction] - FACTION_ANGLES[viewerFaction]) * Math.PI / 180;
  const cos = Math.cos(factionAngle);
  const sin = Math.sin(factionAngle);
  const x = center.x + lx * cos - ly * sin;
  const y = center.y + lx * sin + ly * cos;
  return { x, y, angle: factionAngle };
}

function drawBoard(ctx, center, viewerFaction, width, height) {
  ctx.fillStyle = '#e8d5a0';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#5a4a2a';
  ctx.lineWidth = 1.5;

  const factions = ['wei', 'shu', 'wu'];
  for (const f of factions) {
    drawFactionGrid(ctx, f, center, viewerFaction);
  }

  // 中心节点
  ctx.fillStyle = '#f4e4b8';
  ctx.strokeStyle = '#5a4a2a';
  ctx.lineWidth = 2;
  drawHexagon(ctx, center.x, center.y, 16);
  ctx.fill();
  ctx.stroke();

  // 河界（Y形，浅蓝）
  drawRivers(ctx, center, viewerFaction);

  // 阵营大字
  for (const f of factions) {
    drawFactionLabel(ctx, f, center, viewerFaction);
  }
}

function drawFactionGrid(ctx, faction, center, viewerFaction) {
  // 横线
  for (let r = 0; r < ROWS; r++) {
    const a = localToCanvas(faction, r, 0, center, viewerFaction);
    const b = localToCanvas(faction, r, COLS - 1, center, viewerFaction);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // 纵线
  for (let c = 0; c < COLS; c++) {
    const a = localToCanvas(faction, 0, c, center, viewerFaction);
    const b = localToCanvas(faction, ROWS - 1, c, center, viewerFaction);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // 九宫米字
  const p1 = localToCanvas(faction, PALACE.rowMin, PALACE.colMin, center, viewerFaction);
  const p2 = localToCanvas(faction, PALACE.rowMax, PALACE.colMax, center, viewerFaction);
  const p3 = localToCanvas(faction, PALACE.rowMin, PALACE.colMax, center, viewerFaction);
  const p4 = localToCanvas(faction, PALACE.rowMax, PALACE.colMin, center, viewerFaction);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
  ctx.stroke();

  // 1-9 数字标注（后方边缘 row 0 下方）
  ctx.fillStyle = '#5a4a2a';
  ctx.font = 'bold 11px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < COLS; c++) {
    const pos = localToCanvas(faction, -0.5, c, center, viewerFaction);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(FACTION_ANGLES[faction] - FACTION_ANGLES[viewerFaction]);
    ctx.fillText(String(c + 1), 0, 0);
    ctx.restore();
  }
}

function drawHexagon(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Y形河界：三条浅蓝带，在每两个阵营之间。
function drawRivers(ctx, center, viewerFaction) {
  ctx.save();
  ctx.fillStyle = 'rgba(86, 180, 233, 0.35)';
  ctx.strokeStyle = '#2c7fa6';
  ctx.lineWidth = 1.5;
  // 每条河界画在"两个相邻阵营的交界"——简化为三个粗短带从中心向外
  const factions = ['wei', 'shu', 'wu'];
  for (let i = 0; i < 3; i++) {
    const f1 = factions[i];
    const f2 = factions[(i + 1) % 3];
    // 中点在两阵营夹角的中分线、距中心约 ROWS*CELL*0.6
    const midAngle = ((FACTION_ANGLES[f1] + FACTION_ANGLES[f2]) / 2 - FACTION_ANGLES[viewerFaction]) * Math.PI / 180;
    const dist = ROWS * CELL * 0.5;
    const bx = center.x + Math.cos(midAngle - Math.PI / 2) * dist;
    const by = center.y + Math.sin(midAngle - Math.PI / 2) * dist;
    // 简化：画一个椭圆
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(midAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, CELL * 1.5, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawFactionLabel(ctx, faction, center, viewerFaction) {
  // 大字在阵营后方中点下方
  const pos = localToCanvas(faction, -1.5, 4, center, viewerFaction);
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate((FACTION_ANGLES[faction] - FACTION_ANGLES[viewerFaction]) * Math.PI / 180);
  ctx.fillStyle = FACTION_COLORS[faction];
  ctx.globalAlpha = 0.18;
  ctx.font = 'bold 80px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(FACTION_LABELS[faction], 0, 0);
  ctx.restore();
}

function drawPiece(ctx, cell, center, viewerFaction, isSelected) {
  let pos;
  let faction = cell.faction || cell.owner;
  if (cell.key === 'center') {
    pos = { x: center.x, y: center.y, angle: 0 };
  } else {
    const [f, row, col] = cell.key.split(':');
    pos = localToCanvas(f, Number(row), Number(col), center, viewerFaction);
    faction = f;
  }

  if (isSelected) {
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 12;
  }

  if (cell.hidden) {
    const grad = ctx.createRadialGradient(pos.x - 3, pos.y - 3, 2, pos.x, pos.y, RADIUS);
    grad.addColorStop(0, '#5a6a7a');
    grad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = FACTION_COLORS[cell.owner] || '#6f7782';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 16px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', pos.x, pos.y + 1);
  } else {
    const color = FACTION_COLORS[cell.faction] || '#333';
    const bgGrad = ctx.createRadialGradient(pos.x - 2, pos.y - 2, 2, pos.x, pos.y, RADIUS);
    bgGrad.addColorStop(0, '#fffef5');
    bgGrad.addColorStop(1, cell.faction === 'wei' ? '#fde8e8' : cell.faction === 'wu' ? '#e8f5e8' : '#e8e8f0');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${RADIUS * 1.1}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ch = PIECE_CHARS[cell.piece]?.[cell.faction] || '?';
    ctx.fillText(ch, pos.x, pos.y + 1);
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function drawHighlights(ctx, highlights, center, viewerFaction) {
  for (const h of highlights) {
    let pos;
    if (h.key === 'center') {
      pos = { x: center.x, y: center.y };
    } else {
      const [f, row, col] = h.key.split(':');
      pos = localToCanvas(f, Number(row), Number(col), center, viewerFaction);
    }
    if (h.isCapture) {
      ctx.strokeStyle = 'rgba(220, 50, 50, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, RADIUS + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(60, 150, 90, 0.7)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLastMove(ctx, moveResult, center, viewerFaction) {
  const move = moveResult?.move || moveResult;
  if (!move) return;
  const keys = move.type === 'flip' ? [move.key] : [move.fromKey, move.toKey];
  for (const key of keys) {
    if (!key) continue;
    let pos;
    if (key === 'center') {
      pos = { x: center.x, y: center.y };
    } else {
      const [f, row, col] = key.split(':');
      pos = localToCanvas(f, Number(row), Number(col), center, viewerFaction);
    }
    ctx.fillStyle = 'rgba(255, 215, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, RADIUS + 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 生成棋盘上所有节点（含空格），用于点击命中。每阵营 6×9 + center。
function allNodes(center, viewerFaction) {
  const nodes = [];
  for (const f of ['wei', 'shu', 'wu']) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const pos = localToCanvas(f, r, c, center, viewerFaction);
        nodes.push({ key: `${f}:${r}:${c}`, x: pos.x, y: pos.y });
      }
    }
  }
  nodes.push({ key: 'center', x: center.x, y: center.y });
  return nodes;
}

// 像素 → cellKey：遍历所有棋盘节点找最近（覆盖空格，确保可点击）。
function getClickedCell(event, canvas, center, viewerFaction, width, height) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  const nodes = allNodes(center, viewerFaction);
  let best = null;
  let bestDist = (RADIUS + 8) * (RADIUS + 8);
  for (const node of nodes) {
    const dx = x - node.x;
    const dy = y - node.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = node.key;
    }
  }
  return best ? { key: best } : null;
}

export default function ThreeBoard({ gameState, myColor, socket, gameOver, moveResult }) {
  const canvasRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [highlights, setHighlights] = useState([]);

  const cells = gameState?.cells || [];
  const isGameActive = gameState?.status === 'playing';
  const isMyTurn = gameState?.currentTurn === myColor && isGameActive && !gameOver;

  // 画布尺寸：以中心为原点，需容纳三阵营展开
  const reach = ROWS * CELL + MARGIN + 40;
  const width = (reach + 30) * 2;
  const height = (reach + 30) * 2;
  const center = { x: width / 2, y: height / 2 };

  useEffect(() => {
    setSelected(null);
    setHighlights([]);
  }, [gameState?.currentTurn, gameState?.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    drawBoard(ctx, center, myColor, width, height);
    drawLastMove(ctx, moveResult, center, myColor);
    drawHighlights(ctx, highlights, center, myColor);

    for (const cell of cells) {
      drawPiece(ctx, cell, center, myColor, selected === cell.key);
    }
  }, [cells, center, height, highlights, myColor, moveResult, selected, width]);

  const selectPiece = useCallback((key) => {
    const cell = cells.find((c) => c.key === key);
    if (!cell || cell.owner !== myColor) {
      setSelected(null);
      setHighlights([]);
      return;
    }
    if (gameState.isDark && cell.hidden) {
      setSelected(null);
      setHighlights([]);
      return;
    }
    socket.emit('get_three_moves', { key }, (res) => {
      if (!res?.ok) {
        setSelected(null);
        setHighlights([]);
        return;
      }
      setSelected(key);
      setHighlights((res.moves || []).map((m) => ({
        ...m,
        isCapture: Boolean(cells.find((c) => c.key === m.key)?.piece),
      })));
    });
  }, [cells, gameState, myColor, socket]);

  const handleCanvasClick = useCallback((event) => {
    if (!isMyTurn || cells.length === 0) return;
    const clicked = getClickedCell(event, canvasRef.current, center, myColor, width, height);
    if (!clicked) {
      setSelected(null);
      setHighlights([]);
      return;
    }
    const cell = cells.find((c) => c.key === clicked.key);
    const targetMove = selected && highlights.find((h) => h.key === clicked.key);

    if (selected && targetMove) {
      socket.emit('make_three_move', { fromKey: selected, toKey: clicked.key }, (res) => {
        if (!res?.ok) console.warn('Move rejected:', res?.error);
      });
      setSelected(null);
      setHighlights([]);
      return;
    }

    if (gameState?.isDark && cell?.hidden && cell.owner === myColor) {
      socket.emit('flip_three_piece', { key: clicked.key }, (res) => {
        if (!res?.ok) console.warn('Flip rejected:', res?.error);
      });
      setSelected(null);
      setHighlights([]);
      return;
    }

    selectPiece(clicked.key);
  }, [cells, center, gameState, highlights, isMyTurn, myColor, selectPiece, selected, socket, width]);

  if (!gameState) return null;

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleCanvasClick}
        style={{
          cursor: isMyTurn ? 'pointer' : 'default',
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}
      />
      <div style={{
        textAlign: 'center',
        marginTop: '8px',
        fontSize: '14px',
        color: isMyTurn ? '#2ecc71' : '#e74c3c',
      }}>
        {gameOver ? '游戏结束' : isMyTurn ? (gameState.isDark ? '轮到你翻/走' : '轮到你走') : '等待对手...'}
      </div>
    </div>
  );
}
