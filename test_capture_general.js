// 通过合法走子吃将 → 淘汰 → 继续两方 → 再吃将 → 胜利
const { io } = require('socket.io-client');
const URL = 'http://127.0.0.1:3099';

const A = io(URL, { transports: ['websocket'], forceNew: true }); // wei
const B = io(URL, { transports: ['websocket'], forceNew: true }); // shu
const C = io(URL, { transports: ['websocket'], forceNew: true }); // wu

let st = { A: null, B: null, C: null };
[A, B, C].forEach((s, i) => s.on('game_state', (x) => { st[['A', 'B', 'C'][i]] = x; }));
let log = [];
const ck = (n, c, e = '') => log.push(`${c ? '✓' : '✗'} ${n}${e ? ' :: ' + e : ''}`);

let finished = false;
function finish() {
  if (finished) return; finished = true;
  A.disconnect(); B.disconnect(); C.disconnect();
  setTimeout(() => {
    console.log('\n========== 吃将淘汰→胜利 测试 ==========');
    log.forEach(l => console.log(l));
    const p = log.filter(l => l.startsWith('✓')).length;
    const f = log.filter(l => l.startsWith('✗')).length;
    console.log(`\n通过 ${p} / 失败 ${f} / 共 ${log.length}`);
    console.log(f === 0 ? '\n🎉 全部通过' : '\n❌ 有失败项');
    process.exit(f === 0 ? 0 : 1);
  }, 400);
}
let go = [];
[A, B, C].forEach((s) => s.on('game_over', (d) => go.push(d)));

let ready = 0;
[A, B, C].forEach(s => s.on('connect', () => { ready++; if (ready === 3) setTimeout(run, 100); }));

let rid;
function run() {
  A.emit('create_room', { mode: 'three-open' }, (res) => {
    rid = res.roomId;
    A.emit('select_color', { roomId: rid, color: 'wei' }, () => {
      B.emit('join_room', { roomId: rid }, () => B.emit('select_color', { roomId: rid, color: 'shu' }, () => {
        C.emit('join_room', { roomId: rid }, () => C.emit('select_color', { roomId: rid, color: 'wu' }, () => {
          setTimeout(startCapture, 300);
        }));
      }));
    });
  });
}

// 我们要把 wei 的炮送到能打到 shu 将(shu:0:4)的位置。
// shu 将在九宫 (0,4)。炮在 shu:2:1 和 shu:2:7 —— 但那是 shu 自己的炮。
// 用 wei 的炮：wei 炮在 wei:2:1。需要它打到 shu 将，路径要穿过中心。
// 这条路径很复杂。换一个更直接的方案：
// 把 wei 的车 wei:0:0 通过合法走子推进。但 wei 车在 (0,0)，shu 将在 shu 的 (0,4)，不在同一直线。
//
// 最干净的测试：让 shu 的将主动走到 wei 的炮口（或反之），用合法走子。
// shu 将在 shu:0:4，九宫内可走到 shu:0:3 / shu:0:5 / shu:1:4 等。
// 这些都不在 wei 炮的射线上。
//
// 结论：构造吃将太复杂。改用服务器内部的 session 直接调用（白盒测试）。
whiteboxTest();

function whiteboxTest() {
  // 直接 require session，构造吃将场景
  const { ThreeGameSession } = require('./server/game/three/session.js');
  const s = new ThreeGameSession('X', 'three-open');
  // 手动模拟三席满
  s.players = { wei: 'a', shu: 'b', wu: 'c' };
  s.status = 'playing';

  // 把 wei 的炮放到能打 shu 将的位置：shu 将在 shu:0:4。
  // 在 shu:2:4 放一颗 wei 炮，中间 shu:1:4 放一颗炮架（任意棋子），shu:0:4 是 shu 将。
  // 清空相关格，重新布置
  s.board.delete('wei:2:1');
  s.board.set('shu:2:4', { piece: 'cannon', faction: 'wei', owner: 'wei', hidden: false, crossedCenter: true });
  s.board.set('shu:1:4', { piece: 'pawn', faction: 'wu', owner: 'wu', hidden: false, crossedCenter: true }); // 炮架
  // shu:0:4 已是 shu 将

  // wei 回合，查 wei 炮(shu:2:4)的走法 —— 但炮在 shu 区域，owner=wei，应可走
  s.currentTurn = 'wei';
  const moves = s.getValidMovesForPlayer('shu:2:4', 'wei');
  ck('wei 炮在 shu 区域可查询走法', Array.isArray(moves) && moves.length > 0, JSON.stringify(moves.map(m=>m.key)));
  const canCaptureGeneral = moves.some(m => m.key === 'shu:0:4');
  ck('wei 炮能打到 shu 将(隔炮架)', canCaptureGeneral, '目标 shu:0:4 在走法中');

  if (!canCaptureGeneral) { finish(); return; }

  // 执行吃将
  const r = s.tryMove('shu:2:4', 'shu:0:4', 'wei');
  ck('吃将走子成功', r.ok, r.error);
  ck('蜀被淘汰', s.eliminated.has('shu'), JSON.stringify([...s.eliminated]));
  ck('蜀棋子全部移除', !s.board.size === false && ![...s.board.values()].some(c => c.faction === 'shu'), `蜀棋子=${[...s.board.values()].filter(c=>c.faction==='shu').length}`);
  ck('游戏未结束(还有两方)', s.status === 'playing', s.status);
  ck('剩余棋子=33(魏17含吃将炮+吴16)', s.board.size === 33, `size=${s.board.size}`);

  // 再吃吴将 → 游戏结束，魏胜
  // 把 wei 炮(now at shu:0:4)再布置到能打 wu 将(wu:0:4)的位置
  s.board.delete('shu:0:4'); // 炮移走
  s.board.set('wu:2:4', { piece: 'cannon', faction: 'wei', owner: 'wei', hidden: false, crossedCenter: true });
  s.board.set('wu:1:4', { piece: 'pawn', faction: 'wei', owner: 'wei', hidden: false, crossedCenter: true }); // 炮架(用己方?炮架可以是任意方)
  // 炮架需是任意棋子；用己方 pawn 作架也可以(炮只看"有一颗子"作架)
  s.currentTurn = 'wei';
  const m2 = s.getValidMovesForPlayer('wu:2:4', 'wei');
  ck('wei 炮能打到 wu 将', m2.some(m => m.key === 'wu:0:4'), JSON.stringify(m2.map(m=>m.key)));
  const r2 = s.tryMove('wu:2:4', 'wu:0:4', 'wei');
  ck('吃吴将成功', r2.ok, r2.error);
  ck('游戏结束', s.status === 'finished', s.status);
  ck('魏方获胜', s.winner === 'wei', s.winner);

  finish();
}

setTimeout(() => { console.log('TIMEOUT'); finish(); process.exit(1); }, 15000);
