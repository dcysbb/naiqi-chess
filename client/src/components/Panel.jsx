import React, { useEffect, useState } from 'react';

const PIECE_CHARS = {
  general: { red: '帅', black: '将' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  horse: { red: '傌', black: '馬' },
  chariot: { red: '俥', black: '車' },
  cannon: { red: '炮', black: '砲' },
  pawn: { red: '兵', black: '卒' },
};

const PIECE_NAMES = {
  general: '将/帅',
  advisor: '士/仕',
  elephant: '象/相',
  horse: '马',
  chariot: '车',
  cannon: '炮',
  pawn: '卒/兵',
};

function pieceChar(piece, color) {
  return PIECE_CHARS[piece]?.[color] || '?';
}

function colorLabel(color) {
  return color === 'red' ? '红方' : '黑方';
}

function modeLabel(mode) {
  return mode === 'dark' ? '正常暗棋' : '奶棋';
}

function moveText(moveResult) {
  const move = moveResult?.move || moveResult;
  if (!move) return null;

  if (move.type === 'flip') {
    return `翻开 (${move.col},${move.row})：${pieceChar(move.piece, move.color)}，归属${colorLabel(move.color)}`;
  }

  const parts = [];
  if (move.wasHidden) {
    parts.push('翻开暗子');
  } else {
    parts.push(`${pieceChar(move.piece, move.color)} 移动`);
  }

  parts.push(`(${move.fromCol},${move.fromRow}) -> (${move.toCol},${move.toRow})`);

  if (move.wasHidden) {
    parts.push(`真实身份：${pieceChar(move.piece, move.color)}`);
    if (move.ownerChanged) parts.push(`归属${colorLabel(move.color)}`);
  }

  if (move.captured) {
    const hiddenLabel = move.captured.wasHidden ? '暗子' : '明子';
    parts.push(`吃掉${hiddenLabel}：${pieceChar(move.captured.piece, move.captured.color)}`);
  }

  return parts.join('，');
}

function reasonText(reason) {
  switch (reason) {
    case 'general_lost':
      return '吃掉对方将/帅';
    case 'own_general_captured':
      return '误吃己方将/帅';
    case 'all_captured':
      return '吃光对方棋子';
    case 'opponent_disconnected':
      return '对手断开连接';
    default:
      return '';
  }
}

function normalizedMove(moveResult) {
  return moveResult?.move || moveResult || null;
}

function PieceBadge({ piece, color }) {
  const isRed = color === 'red';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      color: '#f5f5f5',
    }}>
      <span style={{
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isRed ? '#fff2f2' : '#ececf4',
        border: `2px solid ${isRed ? '#c0392b' : '#2c3e50'}`,
        color: isRed ? '#c0392b' : '#2c3e50',
        fontFamily: 'serif',
        fontWeight: 800,
        fontSize: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}>
        {pieceChar(piece, color)}
      </span>
      <span style={{ fontSize: '12px', opacity: 0.84 }}>
        {colorLabel(color)} · {PIECE_NAMES[piece] || '棋子'}
      </span>
    </span>
  );
}

function CapturedReveal({ move }) {
  const captured = move?.captured;
  if (!captured) return null;

  return (
    <div style={{
      marginTop: '8px',
      padding: '8px',
      borderRadius: '6px',
      background: 'rgba(0,0,0,0.18)',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ fontSize: '12px', opacity: 0.68, marginBottom: '6px' }}>
        被吃{captured.wasHidden ? '暗子' : '明子'}真实身份
      </div>
      <PieceBadge piece={captured.piece} color={captured.color} />
    </div>
  );
}

export default function Panel({
  gameState, myColor, roomId, gameOver,
  moveResult, onGoBack, copyFeedback, onCopyRoom,
  rematch, onRematch,
}) {
  const { currentTurn, moveHistory, players, resultReason, mode } = gameState;
  const lastMove = moveResult || moveHistory[moveHistory.length - 1];
  const move = normalizedMove(lastMove);
  const [lastDesc, setLastDesc] = useState(null);

  useEffect(() => {
    setLastDesc(moveText(lastMove));
  }, [lastMove]);

  const winnerLabel = gameOver?.winner ? colorLabel(gameOver.winner) : '';
  const endReason = gameOver?.reason || resultReason;

  const panelStyle = {
    background: 'rgba(255,255,255,0.07)',
    borderRadius: '8px',
    padding: '20px',
    minWidth: '220px',
    maxWidth: '280px',
    backdropFilter: 'blur(10px)',
    height: 'fit-content',
  };

  const tagStyle = (isRed) => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: 'bold',
    background: isRed ? '#c0392b' : '#2c3e50',
    color: '#fff',
    marginRight: '6px',
  });

  return (
    <div style={panelStyle}>
      <div style={{ marginBottom: '12px' }}>
        <h3 style={{ margin: '0 0 4px' }}>房间：{roomId}</h3>
        <div style={{ marginBottom: '8px', opacity: 0.7, fontSize: '12px' }}>{modeLabel(mode)}</div>
        <button
          onClick={onCopyRoom}
          style={{
            padding: '4px 12px',
            fontSize: '11px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            background: copyFeedback ? '#27ae60' : 'rgba(255,255,255,0.12)',
            color: '#fff',
            marginBottom: '8px',
          }}
        >
          {copyFeedback ? '已复制' : '复制房间号'}
        </button>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={tagStyle(true)}>红{myColor === 'red' ? '（你）' : ''}</span>
          <span style={{ fontSize: '12px', opacity: 0.7 }}>{players.red === 'connected' ? '在线' : '等待'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={tagStyle(false)}>黑{myColor === 'black' ? '（你）' : ''}</span>
          <span style={{ fontSize: '12px', opacity: 0.7 }}>{players.black === 'connected' ? '在线' : '等待'}</span>
        </div>
      </div>

      <div style={{
        padding: '10px',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: '8px',
        marginBottom: '12px',
      }}>
        <div style={{ fontSize: '14px', marginBottom: '4px' }}>
          当前回合：<span style={tagStyle(currentTurn === 'red')}>{colorLabel(currentTurn)}</span>
        </div>
        {gameOver && (
          <div style={{
            marginTop: '8px',
            padding: '8px',
            background: 'rgba(231,76,60,0.2)',
            borderRadius: '6px',
            textAlign: 'center',
          }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#e74c3c' }}>
              {winnerLabel ? `${winnerLabel}获胜` : '游戏结束'}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>
              {reasonText(endReason)}
            </div>
          </div>
        )}
      </div>

      {lastDesc && (
        <div style={{
          padding: '8px',
          background: 'rgba(255,215,0,0.1)',
          borderRadius: '6px',
          fontSize: '13px',
          marginBottom: '12px',
          wordBreak: 'break-word',
        }}>
          {lastDesc}
          <CapturedReveal move={move} />
        </div>
      )}

      {gameOver && (
        <button
          onClick={onRematch}
          disabled={rematch?.mine}
          style={{
            width: '100%',
            padding: '12px',
            marginBottom: '10px',
            border: 'none',
            borderRadius: '8px',
            background: rematch?.mine ? '#27ae60' : '#e67e22',
            color: '#fff',
            cursor: rematch?.mine ? 'default' : 'pointer',
            fontSize: '15px',
            fontWeight: 'bold',
            opacity: rematch?.mine ? 0.85 : 1,
          }}
        >
          {rematch?.mine
            ? (rematch?.opp ? '对手已同意，重开中…' : '已申请再来一局，等待对手…')
            : '再来一局'}
        </button>
      )}

      <button
        onClick={onGoBack}
        style={{
          width: '100%',
          padding: '10px',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.08)',
          color: '#ccc',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        离开房间
      </button>
    </div>
  );
}
