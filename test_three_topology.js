const { pathToFileURL } = require('url');
const path = require('path');
const { ROWS, COLS, THREE_FACTIONS } = require('./server/game/three/constants');
const serverMoves = require('./server/game/three/moves');
const { ThreeGameSession } = require('./server/game/three/session');

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  condition ? pass++ : fail++;
  console.log(`${condition ? '✓' : '✗'} ${name}${detail ? ` :: ${detail}` : ''}`);
}

function piece(type, owner = 'wei') {
  return { piece: type, faction: owner, owner, hidden: false, crossedRiver: false };
}

function keys(moves) {
  return moves.map((move) => move.key).sort();
}

(async () => {
  const allNodes = new Set(serverMoves.ROUTES.all.flatMap((route) => route.keys));
  check('棋盘为每方5行', ROWS === 5, `ROWS=${ROWS}`);
  check('棋盘共有135个唯一交叉点', allNodes.size === 135, `nodes=${allNodes.size}`);
  check('棋盘不再包含虚构中心点', !allNodes.has('center'));
  check('所有节点键均有效', [...allNodes].every((key) => {
    const { faction, row, col } = serverMoves.parseKey(key);
    return THREE_FACTIONS.includes(faction) && row >= 0 && row < ROWS && col >= 0 && col < COLS;
  }));

  const centerPawnBoard = new Map([['wei:4:4', piece('pawn')]]);
  check('中兵可选择进入蜀或吴', JSON.stringify(keys(serverMoves.getThreeValidMoves(centerPawnBoard, 'wei:4:4', 'wei'))) === JSON.stringify(['shu:4:4', 'wu:4:4']));

  const sidePawnBoard = new Map([['wei:4:8', piece('pawn')]]);
  check('右侧兵只进入顺时针邻国', JSON.stringify(keys(serverMoves.getThreeValidMoves(sidePawnBoard, 'wei:4:8', 'wei'))) === JSON.stringify(['shu:4:0']));

  const crossedPawnBoard = new Map([['shu:4:0', piece('pawn')]]);
  crossedPawnBoard.get('shu:4:0').crossedRiver = true;
  const crossedPawnMoves = keys(serverMoves.getThreeValidMoves(crossedPawnBoard, 'shu:4:0', 'wei'));
  check('过河兵可前进或横走', crossedPawnMoves.includes('shu:3:0') && crossedPawnMoves.includes('shu:4:1'), JSON.stringify(crossedPawnMoves));
  check('过河兵不能退回本阵', !crossedPawnMoves.some((key) => key.startsWith('wei:')), JSON.stringify(crossedPawnMoves));

  const rookBoard = new Map([['wei:4:4', piece('chariot')]]);
  const rookMoves = keys(serverMoves.getThreeValidMoves(rookBoard, 'wei:4:4', 'wei'));
  check('中车沿丫形线进入蜀', rookMoves.includes('shu:4:4'));
  check('中车沿丫形线进入吴', rookMoves.includes('wu:4:4'));

  const cannonBoard = new Map([
    ['wei:4:8', piece('cannon')],
    ['shu:4:0', piece('pawn', 'shu')],
    ['shu:2:0', piece('general', 'shu')],
  ]);
  const cannonMoves = keys(serverMoves.getThreeValidMoves(cannonBoard, 'wei:4:8', 'wei'));
  check('炮可沿弯折路线隔子吃子', cannonMoves.includes('shu:2:0'), JSON.stringify(cannonMoves));
  check('炮越过炮架后不能停在空点', !cannonMoves.includes('shu:3:0'), JSON.stringify(cannonMoves));

  const horseBoard = new Map([['wei:3:8', piece('horse')]]);
  const horseMoves = keys(serverMoves.getThreeValidMoves(horseBoard, 'wei:3:8', 'wei'));
  check('马可沿合法线路跨河', horseMoves.includes('shu:4:1'), JSON.stringify(horseMoves));
  horseBoard.set('wei:4:8', piece('pawn'));
  const blockedHorseMoves = keys(serverMoves.getThreeValidMoves(horseBoard, 'wei:3:8', 'wei'));
  check('马跨河仍受蹩马腿限制', !blockedHorseMoves.includes('shu:4:1'), JSON.stringify(blockedHorseMoves));

  const elephantBoard = new Map([['wei:2:2', piece('elephant')]]);
  const elephantMoves = keys(serverMoves.getThreeValidMoves(elephantBoard, 'wei:2:2', 'wei'));
  check('象的落点始终留在本阵', elephantMoves.length > 0 && elephantMoves.every((key) => key.startsWith('wei:')), JSON.stringify(elephantMoves));

  const session = new ThreeGameSession('TOPOLOGY', 'three-open');
  const state = session.getPublicState('wei');
  check('公开状态声明新版棋盘协议', state.boardSchema === 'three-135-v1');
  check('公开状态尺寸为5x9', state.rows === 5 && state.cols === 9, `${state.rows}x${state.cols}`);

  const clientModuleUrl = pathToFileURL(path.resolve(__dirname, 'client/src/game/three/moves.js')).href;
  const clientMoves = await import(clientModuleUrl);
  const parityBoard = new Map([['wei:4:4', piece('chariot')], ['shu:2:4', piece('pawn', 'shu')]]);
  check('服务端与内置主机走法一致', JSON.stringify(keys(serverMoves.getThreeValidMoves(parityBoard, 'wei:4:4', 'wei'))) === JSON.stringify(keys(clientMoves.getThreeValidMoves(parityBoard, 'wei:4:4', 'wei'))));

  console.log(`\n通过 ${pass} / 失败 ${fail} / 共 ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
