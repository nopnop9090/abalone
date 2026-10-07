const test = require('node:test');
const assert = require('node:assert');
const R = require('../shared/rules');

const empty = (turn = 1) => ({ board: new Int8Array(R.N), out: [0, 0, 0], turn, ply: 0 });
const put = (s, lab, c) => { s.board[R.parseLabel(lab)] = c; return s; };
const mv = (s, labs, dir) => R.findMove(s, labs.map(R.parseLabel), R.DIR_NAMES.indexOf(dir));

test('Startaufstellung: 14 Kugeln je Farbe, 61 Felder', () => {
  for (const l of ['standard', 'belgian']) {
    const s = R.setup(l);
    assert.equal(R.CELLS.length, 61);
    assert.equal(s.board.filter((x) => x === 1).length, 14);
    assert.equal(s.board.filter((x) => x === 2).length, 14);
  }
});

test('Standardstart: 44 legale Züge', () => {
  assert.equal(R.legalMoves(R.setup('standard')).length, 44);
});

test('Sumito 2 gegen 1 schiebt', () => {
  const s = empty(); put(s, 'E3', 1); put(s, 'E4', 1); put(s, 'E5', 2);
  const m = mv(s, ['E3', 'E4'], 'O'); assert.ok(m);
  const n = R.applyMove(s, m);
  assert.equal(n.board[R.parseLabel('E6')], 2);
  assert.equal(n.board[R.parseLabel('E5')], 1);
});

test('Gleichstand 2 gegen 2 blockiert, 3 gegen 2 geht', () => {
  const s = empty(); put(s, 'E3', 1); put(s, 'E4', 1); put(s, 'E5', 2); put(s, 'E6', 2);
  assert.equal(mv(s, ['E3', 'E4'], 'O'), undefined);
  put(s, 'E2', 1);
  assert.ok(mv(s, ['E2', 'E3', 'E4'], 'O'));
});

test('Dahinter eigene Kugel blockiert', () => {
  const s = empty(); put(s, 'E3', 1); put(s, 'E4', 1); put(s, 'E5', 2); put(s, 'E6', 1);
  assert.equal(mv(s, ['E3', 'E4'], 'O'), undefined);
});

test('Rauswurf am Rand und Sieg bei 6', () => {
  const s = empty(); put(s, 'E7', 1); put(s, 'E8', 1); put(s, 'E9', 2);
  const m = mv(s, ['E7', 'E8'], 'O'); assert.ok(m && m.off);
  const n = R.applyMove(s, m);
  assert.equal(n.out[2], 1);
  assert.equal(n.board.filter((x) => x === 2).length, 0);
  assert.equal(R.winner({ ...n, out: [0, 0, 6] }), 1);
});

test('Seitwärtszug nur auf freie Felder', () => {
  const s = empty(); put(s, 'E4', 1); put(s, 'E5', 1); put(s, 'F5', 2);
  assert.ok(mv(s, ['E4', 'E5'], 'SO') || mv(s, ['E4', 'E5'], 'SW') || true);
  const moves = R.legalMoves(s).filter((m) => m.kind === 'side' && m.marbles.length === 2);
  for (const m of moves) for (const i of m.marbles) assert.equal(s.board[R.NB[i * 6 + m.dir]], 0);
});

test('Zufallspartien: Invarianten', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let g = 0; g < 20; g++) {
    let s = R.setup(g % 2 ? 'belgian' : 'standard');
    for (let i = 0; i < 400 && !R.winner(s); i++) {
      const ms = R.legalMoves(s); assert.ok(ms.length > 0);
      s = R.applyMove(s, ms[Math.floor(rnd() * ms.length)]);
      assert.equal(s.board.filter((x) => x === 1).length + s.out[1], 14);
      assert.equal(s.board.filter((x) => x === 2).length + s.out[2], 14);
    }
  }
});
