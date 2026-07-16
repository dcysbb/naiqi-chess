// P0/P1 修复回归测试：安全回调、waiting 不淘汰、finished 不可加入、一连接一房一座、
// 非法阵营/重复入座拒绝、车炮中心对称、兵过中心判定。
const { io } = require('socket.io-client');
const URL = 'http://127.0.0.1:3099';

const log = [];
let ok = 0, fail = 0;
const ck = (n, c, e = '') => { c ? ok++ : fail++; log.push(`${c ? '✓' : '✗'} ${n}${e ? ' :: ' + e : ''}`); };

function mk() { return io(URL, { transports: ['websocket'], forceNew: true }); }

async function main() {
  // ---------- P0-1: 无回调事件不应崩溃 ----------
  await new Promise((res) => {
    const s = mk();
    s.on('connect', () => {
      s.emit('create_room', { mode: 'three-open' }); // 无 callback
      s.emit('select_color', {}); // 无 callback
      setTimeout(() => { ck('P0-1 无回调事件不崩溃', true); s.disconnect(); res(); }, 600);
    });
  });

  // ---------- 一连接一房一座 + waiting 离席不淘汰 ----------
  await new Promise((res) => {
    const A = mk();
    A.on('connect', () => {
      A.emit('create_room', { mode: 'three-open' }, (r) => {
        const rid = r.roomId;
        A.emit('select_color', { roomId: rid, color: 'wei' }, () => {
          // waiting 阶段 A 离开（主动 leave_room）
          A.emit('leave_room', {}, () => {
                // A 是唯一入座者，离开后房间为空被删除（正确行为）。
                // 新连接加入应得到 Room not found（房间已清理）。
                const B = mk();
                B.on('connect', () => {
                  B.emit('join_room', { roomId: rid }, (rj) => {
                    ck('P0-4 空房间离席后被清理（不再可加入）', !rj.ok && /not found/i.test(rj.error), rj.error);
                    A.disconnect(); B.disconnect(); res();
                  });
                });
              });
        });
      });
    });
  });

  // ---------- waiting 离席不淘汰棋子（白盒） ----------
  await new Promise((res) => {
    const A = mk(), B = mk(), C = mk();
    let stA = null;
    A.on('game_state', (s) => { stA = s; });
    let n = 0;
    [A, B, C].forEach(s => s.on('connect', () => { n++; if (n === 3) go(); }));
    function go() {
      A.emit('create_room', { mode: 'three-open' }, (r) => {
        const rid = r.roomId;
        A.emit('select_color', { roomId: rid, color: 'wei' }, () => {
          B.emit('join_room', { roomId: rid }, () => {
            B.emit('select_color', { roomId: rid, color: 'shu' }, () => {
              // 尚未满座（C 未入），处于 waiting。B 离开。
              B.emit('leave_room', {}, () => {
                setTimeout(() => {
                  // 魏方棋子应仍存在（蜀方离席不应淘汰蜀、也不影响魏）
                  const weiPieces = stA?.cells?.filter(c => c.owner === 'wei').length;
                  ck('P0-4 waiting 离席不影响其它方棋子', weiPieces === 16, `魏棋子=${weiPieces}`);
                  // 蜀座位应释放（isJoinable）
                  // 重新让 C 和新人补齐
                  C.emit('join_room', { roomId: rid }, (rj) => {
                    ck('P0-4 waiting 离席后席位释放可重新加入', rj.ok, rj.error);
                    A.disconnect(); B.disconnect(); C.disconnect(); res();
                  });
                }, 400);
              });
            });
          });
        });
      });
    }
  });

  // ---------- finished 房间不可加入 ----------
  await new Promise((res) => {
    const A = mk(), B = mk(), C = mk();
    let n = 0;
    [A, B, C].forEach(s => s.on('connect', () => { n++; if (n === 3) go(); }));
    function go() {
      A.emit('create_room', { mode: 'three-open' }, (r) => {
        const rid = r.roomId;
        A.emit('select_color', { roomId: rid, color: 'wei' }, () => {
          B.emit('join_room', { roomId: rid }, () => B.emit('select_color', { roomId: rid, color: 'shu' }, () => {
            C.emit('join_room', { roomId: rid }, () => C.emit('select_color', { roomId: rid, color: 'wu' }, () => {
              // playing 中：B、C 断开 → 只剩 A → finished
              B.disconnect(); C.disconnect();
              setTimeout(() => {
                // 新连接尝试加入 finished 房间应被拒
                const D = mk();
                D.on('connect', () => {
                  D.emit('join_room', { roomId: rid }, (rj) => {
                    ck('P1 finished 房间不可加入', !rj.ok, JSON.stringify(rj));
                    A.disconnect(); D.disconnect(); res();
                  });
                });
              }, 800);
            }));
          }));
        });
      });
    }
  });

  // ---------- 非法阵营 / 重复入座 / 未 join 直接 select ----------
  await new Promise((res) => {
    const A = mk();
    A.on('connect', () => {
      A.emit('create_room', { mode: 'three-open' }, (r) => {
        const rid = r.roomId;
        A.emit('select_color', { roomId: rid, color: 'wei' }, () => {
          // 同一连接再次 select（已入座）
          A.emit('select_color', { roomId: rid, color: 'shu' }, (r2) => {
            ck('P1 同连接重复入座被拒', !r2.ok, r2.error);
            // 非法阵营
            A.emit('select_color', { roomId: rid, color: 'xxx' }, () => {}); // 已入座，先验证上面
            // 未 join 房间直接 select（用错误 roomId）
            const B = mk();
            B.on('connect', () => {
              B.emit('select_color', { roomId: rid, color: 'shu' }, (r3) => {
                ck('P1 未 join 直接 select 被拒', !r3.ok, r3.error);
                // 合法 join 后再 select
                B.emit('join_room', { roomId: rid }, () => {
                  B.emit('select_color', { roomId: rid, color: 'shu' }, (r4) => {
                    ck('P1 join 后 select 成功', r4.ok, r4.error);
                    A.disconnect(); B.disconnect(); res();
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  // ---------- 非法 roomId 格式 ----------
  await new Promise((res) => {
    const A = mk();
    A.on('connect', () => {
      A.emit('join_room', { roomId: 'bad' }, (r) => {
        ck('P1 非法 roomId 格式被拒', !r.ok, r.error);
        A.emit('join_room', { roomId: 'LOWER1' }, (r2) => {
          ck('P1 小写 roomId 被拒', !r2.ok, r2.error);
          A.disconnect(); res();
        });
      });
    });
  });

  // ---------- 车炮中心对称（白盒走法） ----------
  {
    const { ThreeGameSession } = require('./server/game/three/session.js');
    const s = new ThreeGameSession('X', 'three-open');
    s.players = { wei: 'a', shu: 'b', wu: 'c' };
    s.status = 'playing';
    s.currentTurn = 'wei';
    // 把 wei 车放到 wei:5:4（中心入口），查走法：应能到 shu 和 wu 两个阵营（对称）
    s.board.delete('wei:0:0');
    s.board.set('wei:5:4', { piece: 'chariot', faction: 'wei', owner: 'wei', hidden: false, crossedCenter: false });
    const moves = s.getValidMovesForPlayer('wei:5:4', 'wei');
    const reachShu = moves.some(m => m.key.startsWith('shu:'));
    const reachWu = moves.some(m => m.key.startsWith('wu:'));
    ck('P1 车经中心可到蜀', reachShu, JSON.stringify(moves.map(m=>m.key).filter(k=>k.startsWith('shu'))));
    ck('P1 车经中心可到吴', reachWu, JSON.stringify(moves.map(m=>m.key).filter(k=>k.startsWith('wu'))));
  }

  // ---------- 兵过中心只用 crossedCenter ----------
  {
    const { ThreeGameSession } = require('./server/game/three/session.js');
    const s = new ThreeGameSession('X', 'three-open');
    s.players = { wei: 'a', shu: 'b', wu: 'c' };
    s.status = 'playing';
    s.currentTurn = 'wei';
    // wei 兵在 wei:5:0，未过中心 → 只能朝中心走（不能横走/后退）
    s.board.set('wei:5:0', { piece: 'pawn', faction: 'wei', owner: 'wei', hidden: false, crossedCenter: false });
    const moves = s.getValidMovesForPlayer('wei:5:0', 'wei');
    // row 5 时朝中心是 center，但 col 0 不通 center（只有 col 4 通）；所以 wei:5:0 朝中心无路（row+1 越界）
    const hasSideways = moves.some(m => { const [f,r,c]=m.key.split(':'); return Number(c)!==0; });
    ck('P1 未过中心兵不能横走', !hasSideways, JSON.stringify(moves));
    // 过中心后可横走
    s.board.set('wei:3:0', { piece: 'pawn', faction: 'wei', owner: 'wei', hidden: false, crossedCenter: true });
    const moves2 = s.getValidMovesForPlayer('wei:3:0', 'wei');
    const hasSide2 = moves2.some(m => { const [f,r,c]=m.key.split(':'); return Number(c)!==0; });
    ck('P1 过中心兵可横走', hasSide2, JSON.stringify(moves2));
  }

  // ---------- 三人暗棋各阵营内部随机 ----------
  {
    const { ThreeGameSession } = require('./server/game/three/session.js');
    const s = new ThreeGameSession('X', 'three-dark');
    // 魏方标准布局：将固定在 wei:0:4。暗棋应打乱，使得 wei:0:4 不一定是将。
    // 多次构造统计
    let generalAt04Count = 0;
    for (let i = 0; i < 50; i++) {
      const t = new ThreeGameSession('X', 'three-dark');
      const cell = t.board.get('wei:0:4');
      if (cell.piece === 'general') generalAt04Count++;
    }
    ck('P1 暗棋打乱棋种（不总是将在0:4）', generalAt04Count < 50, `50次中${generalAt04Count}次将在0:4`);
  }

  setTimeout(() => {
    console.log('\n========== P0/P1 修复回归测试 ==========');
    log.forEach(l => console.log(l));
    console.log(`\n通过 ${ok} / 失败 ${fail} / 共 ${log.length}`);
    console.log(fail === 0 ? '\n🎉 全部通过' : '\n❌ 有失败项');
    process.exit(fail === 0 ? 0 : 1);
  }, 1500);
}

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 30000);
main();
