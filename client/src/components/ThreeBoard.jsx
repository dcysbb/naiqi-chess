import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  THREE_FACTIONS, THREE_PIECE_CHARS, FACTION_COLORS, FACTION_LABELS,
  ROWS, COLS, PALACE,
} from '../game/three/constants.js';

const SIZE = 900;
const CENTER = { x: SIZE / 2, y: SIZE / 2 };
const OUTER_RADIUS = 374;
const FRONT_RADIUS = 330;
const CENTER_GAP = 45;
const BACK_SPAN = 42 * Math.PI / 180;
const FRONT_SPAN = 54 * Math.PI / 180;
const RADIUS = 20;
// Array order is clockwise, matching the server's turn/river mapping.
const FACTION_ANGLES = { wei: 0, shu: 240, wu: 120 };

function isFaction(value) {
  return Object.prototype.hasOwnProperty.call(FACTION_ANGLES, value);
}

function polar(radius, angle) {
  return { x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y + Math.sin(angle) * radius };
}

function lerp(a, b, amount) {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
}

function sectorGeometry(faction, viewerFaction) {
  const factionAngle = FACTION_ANGLES[faction] ?? 0;
  const viewerAngle = FACTION_ANGLES[viewerFaction] ?? 0;
  const outward = Math.PI / 2 + (factionAngle - viewerAngle) * Math.PI / 180;
  return {
    outward,
    apex: polar(CENTER_GAP, outward),
    leftOuter: polar(OUTER_RADIUS, outward + BACK_SPAN),
    rightOuter: polar(OUTER_RADIUS, outward - BACK_SPAN),
    leftFront: polar(FRONT_RADIUS, outward + FRONT_SPAN),
    rightFront: polar(FRONT_RADIUS, outward - FRONT_SPAN),
  };
}

// Each faction is a fish-tail half-board: its back rank is a straight outer
// edge and its river rank folds from both banks into the central Y junction.
function nodePosition(faction, row, col, viewerFaction) {
  const safeFaction = isFaction(faction) ? faction : 'wei';
  const safeViewer = isFaction(viewerFaction) ? viewerFaction : 'wei';
  const safeRow = Math.max(0, Math.min(ROWS - 1, Number(row) || 0));
  const safeCol = Math.max(0, Math.min(COLS - 1, Number(col) || 0));
  const geometry = sectorGeometry(safeFaction, safeViewer);
  const u = (safeCol - 4) / 4;
  const back = lerp(geometry.leftOuter, geometry.rightOuter, (u + 1) / 2);
  const front = u <= 0
    ? lerp(geometry.apex, geometry.leftFront, -u)
    : lerp(geometry.apex, geometry.rightFront, u);
  return lerp(back, front, safeRow / (ROWS - 1));
}

function pathThrough(ctx, points, close = false) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

function drawBoard(ctx, viewerFaction) {
  ctx.fillStyle = '#f5eedc';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const outline = THREE_FACTIONS
    .flatMap((faction) => {
      const geometry = sectorGeometry(faction, viewerFaction);
      return [geometry.leftOuter, geometry.rightOuter];
    })
    .sort((a, b) => Math.atan2(a.y - CENTER.y, a.x - CENTER.x) - Math.atan2(b.y - CENTER.y, b.x - CENTER.x));
  pathThrough(ctx, outline, true);
  ctx.fillStyle = '#f0dfb7';
  ctx.fill();
  ctx.strokeStyle = '#342f28';
  ctx.lineWidth = 3;
  ctx.stroke();

  drawRiverBands(ctx, viewerFaction);

  ctx.strokeStyle = '#474139';
  ctx.lineWidth = 1.45;
  for (const faction of THREE_FACTIONS) drawFactionGrid(ctx, faction, viewerFaction);
  drawRiverConnections(ctx, viewerFaction);
  drawOuterCoordinates(ctx, viewerFaction);
  drawRiverLabels(ctx, viewerFaction);
  drawFactionLabels(ctx, viewerFaction);
}

function drawRiverBands(ctx, viewerFaction) {
  for (let i = 0; i < THREE_FACTIONS.length; i++) {
    const faction = THREE_FACTIONS[i];
    const next = THREE_FACTIONS[(i + 1) % THREE_FACTIONS.length];
    const bankA = Array.from({ length: 5 }, (_, offset) => nodePosition(faction, ROWS - 1, 4 + offset, viewerFaction));
    const bankB = Array.from({ length: 5 }, (_, offset) => nodePosition(next, ROWS - 1, offset, viewerFaction));
    pathThrough(ctx, [...bankA, ...bankB], true);
    ctx.fillStyle = 'rgba(190, 218, 219, 0.82)';
    ctx.fill();
    ctx.strokeStyle = '#668d96';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  const centerTriangle = THREE_FACTIONS.map((faction) => sectorGeometry(faction, viewerFaction).apex);
  pathThrough(ctx, centerTriangle, true);
  ctx.fillStyle = '#d9e9e7';
  ctx.fill();
  ctx.strokeStyle = '#668d96';
  ctx.stroke();
}

function drawFactionGrid(ctx, faction, viewerFaction) {
  for (let row = 0; row < ROWS; row++) {
    const points = Array.from({ length: COLS }, (_, col) => nodePosition(faction, row, col, viewerFaction));
    pathThrough(ctx, points);
    ctx.stroke();
  }
  for (let col = 0; col < COLS; col++) {
    const points = Array.from({ length: ROWS }, (_, row) => nodePosition(faction, row, col, viewerFaction));
    pathThrough(ctx, points);
    ctx.stroke();
  }

  const p1 = nodePosition(faction, PALACE.rowMin, PALACE.colMin, viewerFaction);
  const p2 = nodePosition(faction, PALACE.rowMax, PALACE.colMax, viewerFaction);
  const p3 = nodePosition(faction, PALACE.rowMin, PALACE.colMax, viewerFaction);
  const p4 = nodePosition(faction, PALACE.rowMax, PALACE.colMin, viewerFaction);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
  ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
  ctx.stroke();

  for (const [row, columns] of [[2, [1, 7]], [3, [0, 2, 4, 6, 8]]]) {
    for (const col of columns) drawPlacementMark(ctx, nodePosition(faction, row, col, viewerFaction));
  }
}

function drawPlacementMark(ctx, point) {
  const inner = 7;
  const outer = 13;
  ctx.save();
  ctx.strokeStyle = '#756d61';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.moveTo(point.x + sx * inner, point.y + sy * outer);
      ctx.lineTo(point.x + sx * inner, point.y + sy * inner);
      ctx.lineTo(point.x + sx * outer, point.y + sy * inner);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawRiverConnections(ctx, viewerFaction) {
  ctx.save();
  ctx.strokeStyle = '#474139';
  ctx.lineWidth = 1.35;
  for (let i = 0; i < THREE_FACTIONS.length; i++) {
    const faction = THREE_FACTIONS[i];
    const next = THREE_FACTIONS[(i + 1) % THREE_FACTIONS.length];
    for (let col = 5; col < COLS; col++) {
      const a = nodePosition(faction, ROWS - 1, col, viewerFaction);
      const b = nodePosition(next, ROWS - 1, COLS - 1 - col, viewerFaction);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1.7;
  for (const faction of THREE_FACTIONS) {
    const apex = nodePosition(faction, ROWS - 1, 4, viewerFaction);
    ctx.beginPath(); ctx.moveTo(apex.x, apex.y); ctx.lineTo(CENTER.x, CENTER.y); ctx.stroke();
  }
  ctx.restore();
}

function drawOuterCoordinates(ctx, viewerFaction) {
  ctx.save();
  ctx.fillStyle = '#28251f';
  ctx.font = '600 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const faction of THREE_FACTIONS) {
    for (let col = 0; col < COLS; col++) {
      const point = nodePosition(faction, 0, col, viewerFaction);
      const dx = point.x - CENTER.x;
      const dy = point.y - CENTER.y;
      const length = Math.hypot(dx, dy) || 1;
      ctx.fillText(String(COLS - col), point.x + dx / length * 24, point.y + dy / length * 24);
    }
  }
  ctx.restore();
}

function drawRiverLabels(ctx, viewerFaction) {
  ctx.save();
  ctx.fillStyle = '#385f68';
  ctx.font = '600 15px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < THREE_FACTIONS.length; i++) {
    const faction = THREE_FACTIONS[i];
    const next = THREE_FACTIONS[(i + 1) % THREE_FACTIONS.length];
    const a = nodePosition(faction, ROWS - 1, 7, viewerFaction);
    const b = nodePosition(next, ROWS - 1, 1, viewerFaction);
    const point = lerp(a, b, 0.5);
    const apex = lerp(sectorGeometry(faction, viewerFaction).apex, sectorGeometry(next, viewerFaction).apex, 0.5);
    const angle = Math.atan2(point.y - apex.y, point.x - apex.x);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.fillText('河  界', 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawFactionLabels(ctx, viewerFaction) {
  for (const faction of THREE_FACTIONS) {
    const point = nodePosition(faction, 1.35, 4, viewerFaction);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate((FACTION_ANGLES[faction] - FACTION_ANGLES[viewerFaction]) * Math.PI / 180);
    ctx.fillStyle = FACTION_COLORS[faction];
    ctx.globalAlpha = 0.34;
    ctx.font = '700 58px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(FACTION_LABELS[faction], 0, 0);
    ctx.restore();
  }
}

function positionForKey(key, viewerFaction) {
  const [faction, row, col] = String(key).split(':');
  if (!isFaction(faction) || !Number.isFinite(Number(row)) || !Number.isFinite(Number(col))) return null;
  return nodePosition(faction, Number(row), Number(col), viewerFaction);
}

function drawPiece(ctx, cell, viewerFaction, selected) {
  const point = positionForKey(cell.key, viewerFaction);
  if (!point) return;
  ctx.save();
  if (selected) { ctx.shadowColor = '#f1c40f'; ctx.shadowBlur = 14; }
  const color = FACTION_COLORS[cell.faction || cell.owner] || '#333';
  const gradient = ctx.createRadialGradient(point.x - 6, point.y - 7, 3, point.x, point.y, RADIUS);
  if (cell.hidden) {
    gradient.addColorStop(0, '#697681'); gradient.addColorStop(1, '#202632');
  } else {
    gradient.addColorStop(0, '#fffdf5'); gradient.addColorStop(1, '#e9d7b4');
  }
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.arc(point.x, point.y, RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.stroke();
  ctx.fillStyle = cell.hidden ? '#fff' : color;
  ctx.font = cell.hidden ? '700 16px serif' : '700 22px serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const character = cell.hidden ? '?' : THREE_PIECE_CHARS[cell.piece]?.[cell.faction] || '?';
  ctx.fillText(character, point.x, point.y + 1);
  ctx.restore();
}

function drawHighlights(ctx, highlights, viewerFaction) {
  for (const highlight of highlights) {
    const point = positionForKey(highlight.key, viewerFaction);
    if (!point) continue;
    ctx.beginPath();
    if (highlight.isCapture) {
      ctx.strokeStyle = 'rgba(196, 49, 42, 0.9)'; ctx.lineWidth = 3;
      ctx.arc(point.x, point.y, RADIUS + 5, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(38, 135, 82, 0.78)';
      ctx.arc(point.x, point.y, 7, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawLastMove(ctx, moveResult, viewerFaction) {
  const move = moveResult?.move || moveResult;
  if (!move) return;
  const keys = move.type === 'flip' ? [move.key] : [move.fromKey, move.toKey];
  for (const key of keys) {
    const point = positionForKey(key, viewerFaction);
    if (!point) continue;
    ctx.fillStyle = 'rgba(243, 190, 35, 0.34)';
    ctx.beginPath(); ctx.arc(point.x, point.y, RADIUS + 4, 0, Math.PI * 2); ctx.fill();
  }
}

function allNodes(viewerFaction) {
  const nodes = [];
  for (const faction of THREE_FACTIONS) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        nodes.push({ key: `${faction}:${row}:${col}`, ...nodePosition(faction, row, col, viewerFaction) });
      }
    }
  }
  return nodes;
}

function getClickedCell(event, canvas, viewerFaction) {
  const rect = canvas?.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
  const x = (event.clientX - rect.left) * SIZE / rect.width;
  const y = (event.clientY - rect.top) * SIZE / rect.height;
  let best = null;
  let bestDistance = (RADIUS + 10) ** 2;
  for (const node of allNodes(viewerFaction)) {
    const distance = (x - node.x) ** 2 + (y - node.y) ** 2;
    if (distance < bestDistance) { best = node.key; bestDistance = distance; }
  }
  return best;
}

export default function ThreeBoard({ gameState, myColor, socket, gameOver, moveResult }) {
  const canvasRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const cells = gameState?.cells || [];
  const viewerFaction = isFaction(myColor) ? myColor : isFaction(gameState?.yourFaction) ? gameState.yourFaction : 'wei';
  const isMyTurn = gameState?.status === 'playing' && gameState.currentTurn === viewerFaction && !gameOver;

  useEffect(() => { setSelected(null); setHighlights([]); }, [gameState?.currentTurn, gameState?.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || gameState?.boardSchema !== 'three-135-v1') return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawBoard(ctx, viewerFaction);
    drawLastMove(ctx, moveResult, viewerFaction);
    drawHighlights(ctx, highlights, viewerFaction);
    for (const cell of cells) drawPiece(ctx, cell, viewerFaction, selected === cell.key);
  }, [cells, gameState?.boardSchema, highlights, moveResult, selected, viewerFaction]);

  const selectPiece = useCallback((key) => {
    const cell = cells.find((candidate) => candidate.key === key);
    if (!cell || cell.owner !== viewerFaction || (gameState.isDark && cell.hidden)) {
      setSelected(null); setHighlights([]); return;
    }
    socket.emit('get_three_moves', { key }, (response) => {
      if (!response?.ok) { setSelected(null); setHighlights([]); return; }
      setSelected(key);
      setHighlights((response.moves || []).map((move) => ({
        ...move, isCapture: Boolean(cells.find((candidate) => candidate.key === move.key)?.piece),
      })));
    });
  }, [cells, gameState, socket, viewerFaction]);

  const handleCanvasClick = useCallback((event) => {
    if (!isMyTurn || cells.length === 0) return;
    const key = getClickedCell(event, canvasRef.current, viewerFaction);
    if (!key) { setSelected(null); setHighlights([]); return; }
    const cell = cells.find((candidate) => candidate.key === key);
    const targetMove = selected && highlights.find((move) => move.key === key);
    if (selected && targetMove) {
      socket.emit('make_three_move', { fromKey: selected, toKey: key }, (response) => {
        if (!response?.ok) console.warn('Move rejected:', response?.error);
      });
      setSelected(null); setHighlights([]); return;
    }
    if (gameState?.isDark && cell?.hidden && cell.owner === viewerFaction) {
      socket.emit('flip_three_piece', { key }, (response) => {
        if (!response?.ok) console.warn('Flip rejected:', response?.error);
      });
      setSelected(null); setHighlights([]); return;
    }
    selectPiece(key);
  }, [cells, gameState, highlights, isMyTurn, selectPiece, selected, socket, viewerFaction]);

  if (!gameState) return null;
  if (gameState.boardSchema !== 'three-135-v1') {
    return <div style={{ padding: 24, color: '#f2c94c' }}>主机版本过旧，请将主机和客户端都升级到 v1.2.0。</div>;
  }

  return (
    <div className="three-board-wrap">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onClick={handleCanvasClick}
        aria-label="三人象棋棋盘"
        style={{ cursor: isMyTurn ? 'pointer' : 'default', width: '100%', height: 'auto', display: 'block' }}
      />
      <div className={`three-board-turn ${isMyTurn ? 'is-active' : ''}`}>
        {gameOver ? '游戏结束' : isMyTurn ? (gameState.isDark ? '轮到你翻/走' : '轮到你走') : '等待对手...'}
      </div>
    </div>
  );
}
