/* Abalone-Regeln (Browser + Node). Felder: Index = (r+4)*9 + (q+4), axiale Koordinaten. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AbaloneRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 9, N = 81, WIN_AT = 6;
  const BLACK = 1, WHITE = 2;
  // Richtungen: 0 E, 1 W, 2 SE, 3 NW, 4 NE, 5 SW  (d^1 = Gegenrichtung); r wächst nach unten
  const DQ = [1, -1, 0, 0, 1, -1];
  const DR = [0, 0, 1, -1, -1, 1];
  const DIR_NAMES = ['O', 'W', 'SO', 'NW', 'NO', 'SW'];
  const AXES = [0, 2, 4];

  const idxOf = (q, r) => (r + 4) * W + (q + 4);
  const qOf = (i) => (i % W) - 4;
  const rOf = (i) => Math.floor(i / W) - 4;
  const onBoard = (q, r) => Math.abs(q) <= 4 && Math.abs(r) <= 4 && Math.abs(q + r) <= 4;

  const CELLS = [];
  const VALID = new Uint8Array(N);
  for (let r = -4; r <= 4; r++) for (let q = -4; q <= 4; q++) if (onBoard(q, r)) { CELLS.push(idxOf(q, r)); VALID[idxOf(q, r)] = 1; }
  const NB = new Int8Array(N * 6).fill(-1);
  for (const i of CELLS) for (let d = 0; d < 6; d++) {
    const q = qOf(i) + DQ[d], r = rOf(i) + DR[d];
    if (onBoard(q, r)) NB[i * 6 + d] = idxOf(q, r);
  }
  const dist = (i) => Math.max(Math.abs(qOf(i)), Math.abs(rOf(i)), Math.abs(qOf(i) + rOf(i)));

  const other = (c) => 3 - c;

  // ---- Startaufstellungen ----
  function setup(layout) {
    const board = new Int8Array(N);
    const put = (q, r, c) => { board[idxOf(q, r)] = c; };
    if (layout === 'belgian') {
      const top = [[0, -4], [1, -4], [-1, -3], [0, -3], [1, -3], [-1, -2], [0, -2]];
      for (const [q, r] of top) { put(q, r, BLACK); put(-q, -r, BLACK); put(-q - r, r, WHITE); put(q + r, -r, WHITE); }
    } else {
      for (let q = 0; q <= 4; q++) { put(q, -4, BLACK); put(-q, 4, WHITE); }
      for (let q = -1; q <= 4; q++) { put(q, -3, BLACK); put(-q, 3, WHITE); }
      for (let q = 0; q <= 2; q++) { put(q, -2, BLACK); put(-q, 2, WHITE); }
    }
    return { board, out: [0, 0, 0], turn: BLACK, ply: 0 };
  }

  const clone = (s) => ({ board: s.board.slice(), out: s.out.slice(), turn: s.turn, ply: s.ply });

  // ---- Zuggenerierung ----
  // Zug: { marbles:[idx] (entlang axis geordnet), axis, dir, push:[idx] (gegnerische Kugeln), off:boolean, kind }
  function legalMoves(s) {
    const b = s.board, me = s.turn, opp = other(me), moves = [];
    for (const start of CELLS) {
      if (b[start] !== me) continue;
      // Einzelkugel
      for (let m = 0; m < 6; m++) {
        const t = NB[start * 6 + m];
        if (t >= 0 && b[t] === 0) moves.push({ marbles: [start], axis: -1, dir: m, push: [], off: false, kind: 'single' });
      }
      for (const a of AXES) {
        const g = [start];
        for (let n = 2; n <= 3; n++) {
          const nx = NB[g[g.length - 1] * 6 + a];
          if (nx < 0 || b[nx] !== me) break;
          g.push(nx);
          const size = g.length;
          for (let m = 0; m < 6; m++) {
            if (m === a || m === (a ^ 1)) {
              const lead = m === a ? g[size - 1] : g[0];
              const p = NB[lead * 6 + m];
              if (p < 0 || b[p] === me) continue;
              if (b[p] === 0) { moves.push({ marbles: g.slice(), axis: a, dir: m, push: [], off: false, kind: 'inline' }); continue; }
              const pushed = [];
              let q = p;
              while (q >= 0 && b[q] === opp) { pushed.push(q); q = NB[q * 6 + m]; }
              if (pushed.length >= size) continue;
              if (q < 0) moves.push({ marbles: g.slice(), axis: a, dir: m, push: pushed, off: true, kind: 'sumito' });
              else if (b[q] === 0) moves.push({ marbles: g.slice(), axis: a, dir: m, push: pushed, off: false, kind: 'sumito' });
            } else {
              let ok = true;
              for (const x of g) { const t = NB[x * 6 + m]; if (t < 0 || b[t] !== 0) { ok = false; break; } }
              if (ok) moves.push({ marbles: g.slice(), axis: a, dir: m, push: [], off: false, kind: 'side' });
            }
          }
        }
      }
    }
    return moves;
  }

  // Wendet einen Zug an. Liefert neuen Zustand; "steps" = [{from,to(-1=raus),color}] für Animationen.
  function applyMove(s, mv) {
    const n = clone(s);
    const b = n.board, steps = [];
    const all = mv.marbles.concat(mv.push);
    const colors = all.map((i) => b[i]);
    all.forEach((i, k) => { steps.push({ from: i, to: NB[i * 6 + mv.dir], color: colors[k] }); b[i] = 0; });
    for (const st of steps) {
      if (st.to < 0) n.out[st.color]++; else b[st.to] = st.color;
    }
    n.turn = other(s.turn);
    n.ply = s.ply + 1;
    n.steps = steps;
    return n;
  }

  function winner(s) {
    if (s.out[WHITE] >= WIN_AT) return BLACK; // Weiß hat 6 Kugeln verloren
    if (s.out[BLACK] >= WIN_AT) return WHITE;
    return 0;
  }

  const sameMove = (a, b) => a.dir === b.dir && a.marbles.length === b.marbles.length &&
    a.marbles.slice().sort((x, y) => x - y).join() === b.marbles.slice().sort((x, y) => x - y).join();
  const findMove = (s, marbles, dir) => legalMoves(s).find((m) => sameMove(m, { marbles, dir }));

  // ---- Notation / Serialisierung ----
  const label = (i) => String.fromCharCode(65 + (4 - rOf(i))) + (qOf(i) + 5); // A..I von unten (Weiß) nach oben
  const parseLabel = (t) => {
    const m = /^([A-Ia-i])([1-9])$/.exec(String(t).trim());
    if (!m) return -1;
    const r = 4 - (m[1].toUpperCase().charCodeAt(0) - 65), q = +m[2] - 5;
    return onBoard(q, r) ? idxOf(q, r) : -1;
  };
  const moveText = (mv) => mv.marbles.map(label).join(',') + ' ' + DIR_NAMES[mv.dir] +
    (mv.kind === 'sumito' ? (mv.off ? ' (Kugel raus!)' : ' (schiebt)') : '');

  const serialize = (s) => ({ board: Array.from(s.board).join(''), out: s.out, turn: s.turn, ply: s.ply });
  const deserialize = (o) => ({ board: Int8Array.from(o.board.split('').map(Number)), out: o.out.slice(), turn: o.turn, ply: o.ply });

  function ascii(s) {
    const rows = [];
    for (let r = 4; r >= -4; r--) {
      let line = ' '.repeat(Math.abs(r)) + String.fromCharCode(65 + (4 - r)) + ' ';
      for (let q = -4; q <= 4; q++) if (onBoard(q, r)) line += ['.', 'X', 'O'][s.board[idxOf(q, r)]] + ' ';
      rows.push(line.trimEnd());
    }
    return rows.join('\n'); // X = Schwarz, O = Weiß
  }

  return { W, N, WIN_AT, BLACK, WHITE, DQ, DR, DIR_NAMES, CELLS, NB, VALID, idxOf, qOf, rOf, onBoard, dist, other,
    setup, clone, legalMoves, applyMove, winner, sameMove, findMove, label, parseLabel, moveText, serialize, deserialize, ascii };
});
