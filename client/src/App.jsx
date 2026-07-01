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
  const screenRef = useRef(screen);
  const gameHistoryPushedRef = useRef(false);
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

  const handleRoomCancelled = useCallback(() => {
    setRoomId(null);
    setMyColor(null);
    myColorRef.current = null;
    setMoveResult(null);
    setGameOver(null);
    setRematch({ mine: false, opp: false });
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
    screenRef.current = 'room';
    gameHistoryPushedRef.current = false;
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

  const requestGameBack = useCallback(() => {
    if (gameHistoryPushedRef.current && window.history.length > 1) {
      window.history.back();
      return;
    }
    handleGoBack();
  }, [handleGoBack]);

  useEffect(() => {
    screenRef.current = screen;
    if (screen === 'game' && !gameHistoryPushedRef.current) {
      window.history.pushState({ chessView: 'game' }, '');
      gameHistoryPushedRef.current = true;
    }
    if (screen === 'room') {
      gameHistoryPushedRef.current = false;
    }
  }, [screen]);

  useEffect(() => {
    const onBackRequest = () => {
      if (screenRef.current !== 'game') return false;
      handleGoBack();
      return true;
    };

    const onPopState = () => {
      onBackRequest();
    };

    const onKeyDown = (event) => {
      const wantsBack = event.key === 'Escape'
        || event.key === 'BrowserBack'
        || (event.altKey && event.key === 'ArrowLeft');
      if (!wantsBack || screenRef.current !== 'game') return;
      event.preventDefault();
      requestGameBack();
    };

    const onNativeBack = () => {
      onBackRequest();
    };

    window.__chessHandleNativeBack = () => {
      if (onBackRequest()) return true;
      return window.__chessHandleRoomBack?.() === true;
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('native-back', onNativeBack);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('native-back', onNativeBack);
      if (window.__chessHandleNativeBack) delete window.__chessHandleNativeBack;
    };
  }, [handleGoBack, requestGameBack]);

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
          onRoomCancelled={handleRoomCancelled}
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
            onGoBack={requestGameBack}
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
    <div className="app-shell">
      <header className="app-header">
        {screen === 'game' && (
          <button
            type="button"
            className="icon-button app-back-button"
            onClick={requestGameBack}
            title="返回房间"
            aria-label="返回房间"
          >
            ‹
          </button>
        )}
        <h1 className="app-title">奶棋</h1>
        <p className="app-subtitle">局域网联机对战</p>
      </header>

      <main className="app-main">
        {renderContent()}
      </main>
    </div>
  );
}
