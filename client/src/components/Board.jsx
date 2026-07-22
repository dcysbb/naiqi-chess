import React, { useRef, useEffect, useState, useCallback } from 'react';

const CELL = 58;
const MARGIN = 40;
const RADIUS = 24;

const PIECE_CHARS = {
  general: { red: '帅', black: '将' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  horse: { red: '傌', black: '馬' },
  chariot: { red: '俥', black: '車' },
  cannon: { red: '炮', black: '砲' },
  pawn: { red: '兵', black: '卒' },
};

function getMetrics(rows, cols) {
  return {
    width: MARGIN * 2 + CELL * (cols - 1),
    height: MARGIN * 2 + CELL * (rows - 1),
  };
}

// Map a logical (row, col) to canvas pixel coordinates, with the board oriented
// toward `myColor`. Red sees the natural orientation (red at the bottom); black
// sees the board flipped 180° (black at the bottom). Text is kept upright in
// drawPiece via the orientation flag, so this only flips positions.
function viewX(col, cols, myColor) {
  if (myColor === 'black') return MARGIN + (cols - 1 - col) * CELL;
  return MARGIN + col * CELL;
}
function viewY(row, rows, myColor) {
  if (myColor === 'black') return MARGIN + (rows - 1 - row) * CELL;
  return MARGIN + row * CELL;
}

function drawBoard(ctx, mode, rows, cols, width, height, flip) {
  ctx.fillStyle = '#e8d5a0';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#5a4a2a';
  ctx.lineWidth = 1.5;

  if (mode === 'dark') {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = viewX(c, cols, flip ? 'black' : 'red');
        const y = viewY(r, rows, flip ? 'black' : 'red');
        ctx.fillStyle = (r + c) % 2 === 0 ? '#e9d9ad' : '#dec78e';
        ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
        ctx.strokeRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
      }
    }
    return;
  }

  for (let r = 0; r < rows; r++) {
    const y = viewY(r, rows, flip ? 'black' : 'red');
    ctx.beginPath();
    ctx.moveTo(viewX(0, cols, flip ? 'black' : 'red'), y);
    ctx.lineTo(viewX(cols - 1, cols, flip ? 'black' : 'red'), y);
    ctx.stroke();
  }

  for (let c = 0; c < cols; c++) {
    const x = viewX(c, cols, flip ? 'black' : 'red');
    if (c === 0 || c === cols - 1) {
      ctx.beginPath();
      ctx.moveTo(x, viewY(0, rows, flip ? 'black' : 'red'));
      ctx.lineTo(x, viewY(rows - 1, rows, flip ? 'black' : 'red'));
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, viewY(0, rows, flip ? 'black' : 'red'));
      ctx.lineTo(x, viewY(4, rows, flip ? 'black' : 'red'));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, viewY(5, rows, flip ? 'black' : 'red'));
      ctx.lineTo(x, viewY(rows - 1, rows, flip ? 'black' : 'red'));
      ctx.stroke();
    }
  }

  // Palace diagonals: draw them at the actual displayed positions regardless of flip.
  const palace = flip ? 'black' : 'red';
  drawPalaceDiag(ctx, 3, 0, 5, 2, cols, rows, palace);
  drawPalaceDiag(ctx, 3, 7, 5, 9, cols, rows, palace);

  ctx.fillStyle = '#5a4a2a';
  ctx.font = 'bold 26px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const riverY = (viewY(4, rows, palace) + viewY(5, rows, palace)) / 2;
  ctx.fillText('楚 河', viewX(1.5, cols, palace), riverY);
  ctx.fillText('汉 界', viewX(6.5, cols, palace), riverY);
}

function drawPalaceDiag(ctx, c1, r1, c2, r2, cols, rows, palace) {
  ctx.beginPath();
  ctx.moveTo(viewX(c1, cols, palace), viewY(r1, rows, palace));
  ctx.lineTo(viewX(c2, cols, palace), viewY(r2, rows, palace));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(viewX(c2, cols, palace), viewY(r1, rows, palace));
  ctx.lineTo(viewX(c1, cols, palace), viewY(r2, rows, palace));
  ctx.stroke();
}

function drawHighlights(ctx, highlights, rows, cols, flip) {
  const palace = flip ? 'black' : 'red';
  for (const { row, col, isCapture } of highlights) {
    const x = viewX(col, cols, palace);
    const y = viewY(row, rows, palace);
    if (isCapture) {
      ctx.strokeStyle = 'rgba(220, 50, 50, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, RADIUS + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(60, 150, 90, 0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPiece(ctx, row, col, pieceData, isSelected, rows, cols, flip) {
  const x = viewX(col, cols, flip ? 'black' : 'red');
  const y = viewY(row, rows, flip ? 'black' : 'red');

  if (isSelected) {
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 12;
  }

  if (pieceData.hidden) {
    const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, RADIUS);
    grad.addColorStop(0, '#5a6a7a');
    grad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pieceData.owner === 'red' ? '#c0392b' : pieceData.owner === 'black' ? '#2c3e50' : '#6f7782';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y + 1);
  } else {
    const isRed = pieceData.color === 'red';
    const bgGrad = ctx.createRadialGradient(x - 2, y - 2, 2, x, y, RADIUS);
    bgGrad.addColorStop(0, '#fffef5');
    bgGrad.addColorStop(1, isRed ? '#fde8e8' : '#e8e8f0');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isRed ? '#c0392b' : '#2c3e50';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = isRed ? '#c0392b' : '#2c3e50';
    ctx.font = `bold ${RADIUS * 1.2}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_CHARS[pieceData.piece]?.[pieceData.color] || '?', x, y + 1);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

function drawLastMove(ctx, moveResult, rows, cols, flip) {
  const move = moveResult?.move || moveResult;
  if (!move) return;
  const palace = flip ? 'black' : 'red';

  const points = move.type === 'flip'
    ? [{ row: move.row, col: move.col }]
    : [{ row: move.fromRow, col: move.fromCol }, { row: move.toRow, col: move.toCol }];

  for (const { row, col } of points) {
    ctx.fillStyle = 'rgba(255, 215, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(viewX(col, cols, palace), viewY(row, rows, palace), RADIUS + 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function getClickedCell(event, canvas, rows, cols, width, height, flip) {
  const rect = canvas.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  // Reverse-map displayed pixel coords back to logical (row, col).
  const palace = flip ? 'black' : 'red';
  let col = (x - MARGIN) / CELL;
  let row = (y - MARGIN) / CELL;
  if (flip) {
    col = (cols - 1) - col;
    row = (rows - 1) - row;
  }
  col = Math.round(col);
  row = Math.round(row);

  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  const dx = Math.abs(x - viewX(col, cols, palace));
  const dy = Math.abs(y - viewY(row, rows, palace));
  return dx <= RADIUS + 8 && dy <= RADIUS + 8 ? { row, col } : null;
}

export default function Board({ gameState, myColor, socket, gameOver, moveResult }) {
  const canvasRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [highlights, setHighlights] = useState([]);

  const board = gameState?.board;
  const mode = gameState?.mode || 'chaos';
  const rows = gameState?.rows || board?.length || 10;
  const cols = gameState?.cols || board?.[0]?.length || 9;
  const { width, height } = getMetrics(rows, cols);
  const isGameActive = gameState?.status === 'playing';
  const isMyTurn = gameState?.currentTurn === myColor && isGameActive && !gameOver;
  // Black sees the board rotated 180° so their pieces sit at the bottom.
  const flip = myColor === 'black';

  useEffect(() => {
    setSelected(null);
    setHighlights([]);
  }, [gameState?.currentTurn, gameState?.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !board) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    drawBoard(ctx, mode, rows, cols, width, height, flip);
    drawLastMove(ctx, moveResult, rows, cols, flip);
    drawHighlights(ctx, highlights, rows, cols, flip);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const piece = board[row]?.[col];
        if (!piece) continue;
        drawPiece(ctx, row, col, piece, selected?.row === row && selected?.col === col, rows, cols, flip);
      }
    }
  }, [board, cols, flip, height, highlights, mode, moveResult, rows, selected, width]);

  const selectPiece = useCallback((row, col) => {
    const cell = board?.[row]?.[col];
    if (!cell || cell.owner !== myColor || (mode === 'dark' && cell.hidden)) {
      setSelected(null);
      setHighlights([]);
      return;
    }

    socket.emit('get_valid_moves', { row, col }, (res) => {
      if (!res?.ok) {
        setSelected(null);
        setHighlights([]);
        return;
      }

      setSelected({ row, col });
      setHighlights((res.moves || []).map((move) => ({
        ...move,
        isCapture: Boolean(board?.[move.row]?.[move.col]),
      })));
    });
  }, [board, mode, myColor, socket]);

  const handleCanvasClick = useCallback((event) => {
    if (!isMyTurn || !board) return;

    const clicked = getClickedCell(event, canvasRef.current, rows, cols, width, height, flip);
    if (!clicked) {
      setSelected(null);
      setHighlights([]);
      return;
    }

    const cell = board?.[clicked.row]?.[clicked.col];
    const targetMove = selected && highlights.find(
      (move) => move.row === clicked.row && move.col === clicked.col,
    );

    if (selected && targetMove) {
      socket.emit('make_move', {
        fromRow: selected.row,
        fromCol: selected.col,
        toRow: clicked.row,
        toCol: clicked.col,
      }, (res) => {
        if (!res?.ok) console.warn('Move rejected:', res?.error);
      });
      setSelected(null);
      setHighlights([]);
      return;
    }

    if (mode === 'dark' && cell?.hidden) {
      socket.emit('flip_piece', clicked, (res) => {
        if (!res?.ok) console.warn('Flip rejected:', res?.error);
      });
      setSelected(null);
      setHighlights([]);
      return;
    }

    setSelected(null);
    setHighlights([]);
  }, [board, cols, flip, height, highlights, isMyTurn, mode, rows, selected, selectPiece, socket, width]);

  const handleCanvasDoubleClick = useCallback((event) => {
    if (!isMyTurn || !board) return;

    const clicked = getClickedCell(event, canvasRef.current, rows, cols, width, height, flip);
    if (!clicked) {
      setSelected(null);
      setHighlights([]);
      return;
    }

    selectPiece(clicked.row, clicked.col);
  }, [board, cols, flip, height, isMyTurn, rows, selectPiece, width]);

  if (!board) return null;

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
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
        {gameOver ? '游戏结束' : isMyTurn ? (mode === 'dark' ? '轮到你翻/走' : '轮到你走') : '等待对手...'}
      </div>
    </div>
  );
}
