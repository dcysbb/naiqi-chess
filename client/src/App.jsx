import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket, DEFAULT_URL } from './socket.js';
import Room from './components/Room.jsx';
import Board from './components/Board.jsx';
import Panel from './components/Panel.jsx';

export default function App() {
  const [screen, setScreen] = useState('room');
  const [roomId, setRoomId] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const myColorRef = useRef(null);
  const [gameState, setGameState] = useState(null);
  const [moveResult, setMoveResult] = useState(null);
  const [gameOver, setGameOver] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [rematch, setRematch] = useState({ mine: false, opp: false });

  useEffect(() => {
    // Only auto-connect if there's a default server to reach. On mobile
    // (Capacitor) there is none — the user must pick a LAN host first.
    if (DEFAULT_URL) socket.connect();

    const onGameState = (state) => {
      setGameState(state);
      if (state.status !== 'finished') setGameOver(null);
      // Sync rematch flags from authoritative server state when available.
      if (state.rematch) {
        const oppColor = myColorRef.current === 'red' ? 'black' : 'red';
        setRematch({
          mine: Boolean(state.rematch[myColorRef.current]),
          opp: Boolean(state.rematch[oppColor]),
        });
      }
      setScreen('game');
    };
    const onMoveMade = (data) => setMoveResult(data);
    const onGameOver = (data) => setGameOver(data);
    const onOpponentDisconnected = () => {
      setGameOver({ winner: myColorRef.current, reason: 'opponent_disconnected' });
    };
    const onRematchUpdate = ({ who }) => {
      // Opponent (who !== myColor) is requesting; mark their flag.
      if (who && who !== myColorRef.current) {
        setRematch((prev) => ({ ...prev, opp: true }));
      }
    };
    const onRematchStarted = () => {
      setRematch({ mine: false, opp: false });
      setMoveResult(null);
      setGameOver(null);
    };
    const onOpponentLeft = () => {
      setGameOver({ winner: myColorRef.current, reason: 'opponent_disconnected' });
      setRematch({ mine: false, opp: false });
    };

    socket.on('game_state', onGameState);
    socket.on('move_made', onMoveMade);
    socket.on('game_over', onGameOver);
    socket.on('opponent_disconnected', onOpponentDisconnected);
    socket.on('rematch_update', onRematchUpdate);
    socket.on('rematch_started', onRematchStarted);
    socket.on('opponent_left', onOpponentLeft);

    return () => {
      socket.off('game_state', onGameState);
      socket.off('move_made', onMoveMade);
      socket.off('game_over', onGameOver);
      socket.off('opponent_disconnected', onOpponentDisconnected);
      socket.off('rematch_update', onRematchUpdate);
      socket.off('rematch_started', onRematchStarted);
      socket.off('opponent_left', onOpponentLeft);
      socket.disconnect();
    };
  }, []);

  const handleRoomCreated = useCallback((id) => {
    setRoomId(id);
    setMoveResult(null);
    setGameOver(null);
  }, []);

  const handleRoomJoined = useCallback((id) => {
    setRoomId(id);
    setMoveResult(null);
    setGameOver(null);
  }, []);

  const handleColorSelected = useCallback((color) => {
    setMyColor(color);
    myColorRef.current = color;
  }, []);

  const handleCopyRoom = useCallback(() => {
    if (!roomId) return;

    const showCopied = () => {
      setCopyFeedback(true);
      window.setTimeout(() => setCopyFeedback(false), 2000);
    };

    navigator.clipboard.writeText(roomId).then(showCopied).catch(() => {
      const input = document.createElement('input');
      input.value = roomId;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showCopied();
    });
  }, [roomId]);

  const handleGoBack = useCallback(() => {
    socket.emit('leave_room');
    setScreen('room');
    setRoomId(null);
    setMyColor(null);
    myColorRef.current = null;
    setGameState(null);
    setMoveResult(null);
    setGameOver(null);
    setRematch({ mine: false, opp: false });
  }, []);

  const handleRematch = useCallback(() => {
    if (!roomId || !myColor) return;
    setRematch((prev) => ({ ...prev, mine: true }));
    socket.emit('request_rematch', { roomId }, (res) => {
      if (!res?.ok) {
        setRematch({ mine: false, opp: false });
      }
    });
  }, [roomId, myColor]);

  const renderContent = () => {
    if (screen === 'room') {
      return (
        <Room
          onRoomCreated={handleRoomCreated}
          onRoomJoined={handleRoomJoined}
          onColorSelected={handleColorSelected}
          copyFeedback={copyFeedback}
          onCopyRoom={handleCopyRoom}
        />
      );
    }

    if (screen === 'game' && gameState) {
      return (
        <>
          <Board
            gameState={gameState}
            myColor={myColor}
            socket={socket}
            gameOver={gameOver}
            moveResult={moveResult}
          />
          <Panel
            gameState={gameState}
            myColor={myColor}
            roomId={roomId}
            gameOver={gameOver}
            moveResult={moveResult}
            onGoBack={handleGoBack}
            copyFeedback={copyFeedback}
            onCopyRoom={handleCopyRoom}
            rematch={rematch}
            onRematch={handleRematch}
          />
        </>
      );
    }

    return <div style={{ color: '#e74c3c', padding: 20 }}>正在连接...</div>;
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <header style={{
        textAlign: 'center',
        padding: '16px',
        background: 'rgba(0,0,0,0.3)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '4px' }}>暗棋象棋</h1>
        <p style={{ margin: '4px 0 0', fontSize: '12px', opacity: 0.6 }}>Hidden Piece Chinese Chess</p>
      </header>

      <main style={{ display: 'flex', justifyContent: 'center', padding: '16px', gap: '16px', flexWrap: 'wrap' }}>
        {renderContent()}
      </main>
    </div>
  );
}
