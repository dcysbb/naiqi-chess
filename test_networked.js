// 完整联机流程：3客户端选座 + 走子 + 三方互收状态
const { io } = require('socket.io-client');
const URL = 'http://127.0.0.1:3099';
const mk = () => io(URL, { transports: ['websocket'], forceNew: true });
const A = mk(), B = mk(), C = mk();

let sa = null, sb = null, sc = null;
A.on('game_state', s => { sa = s; });
B.on('game_state', s => { sb = s; });
C.on('game_state', s => { sc = s; });

let movesSeen = { A: 0, B: 0, C: 0 };
A.on('move_made', () => movesSeen.A++);
B.on('move_made', () => movesSeen.B++);
C.on('move_made', () => movesSeen.C++);

let n = 0;
[A, B, C].forEach(s => s.on('connect', () => { n++; if (n === 3) go(); }));

let ok = 0, fail = 0;
const ck = (c, m) => { c ? ok++ : fail++; console.log((c ? '✓' : '✗') + ' ' + m); };

function go() {
  A.emit('create_room', { mode: 'three-open' }, (r) => {
    const rid = r.roomId;
    A.emit('select_color', { roomId: rid, color: 'wei' }, () => {
      B.emit('join_room', { roomId: rid }, () => {
        B.emit('select_color', { roomId: rid, color: 'shu' }, () => {
          C.emit('join_room', { roomId: rid }, () => {
            C.emit('select_color', { roomId: rid, color: 'wu' }, () => {
              setTimeout(() => afterSeated(rid), 400);
            });
          });
        });
      });
    });
  });
}

function afterSeated(rid) {
  ck(sa && sa.status === 'playing', '三方满座 playing');
  ck(sa && sa.currentTurn === 'wei', '初始回合魏');
  ck(sa && sa.cells.length === 48, '48棋子');
  A.emit('make_three_move', { fromKey: 'wei:3:0', toKey: 'wei:4:0' }, (mm) => {
    ck(mm.ok, '魏走子');
    setTimeout(() => {
      ck(movesSeen.B >= 1, 'B收到走子通知');
      ck(movesSeen.C >= 1, 'C收到走子通知');
      ck(sb && sb.currentTurn === 'shu', '回合转蜀');
      ck(sa && sa.yourFaction === 'wei', 'A视角=魏');
      ck(sb && sb.yourFaction === 'shu', 'B视角=蜀');
      ck(sc && sc.yourFaction === 'wu', 'C视角=吴');
      done();
    }, 400);
  });
}

function done() {
  A.disconnect(); B.disconnect(); C.disconnect();
  setTimeout(() => {
    console.log(`\n通过 ${ok} / 失败 ${fail}`);
    console.log(fail === 0 ? '🎉 全部通过' : '❌ 有失败');
    process.exit(fail === 0 ? 0 : 1);
  }, 400);
}

setTimeout(() => { console.log('TIMEOUT'); done(); process.exit(1); }, 12000);
