/* Computer-Gegner: Negamax mit Alpha-Beta und Iterative Deepening. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules'));
  else root.AbaloneAI = factory(root.AbaloneRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  const WIN = 1e6;

  function evaluate(s, me) {
    const opp = R.other(me), b = s.board;
    let score = 1000 * (s.out[opp] - s.out[me]);
    let c = 0;
    for (const i of R.CELLS) {
      const col = b[i];
      if (!col) continue;
      const sign = col === me ? 1 : -1;
      let v = (4 - R.dist(i)) * 6;          // Zentrum
      if (R.dist(i) === 4) v -= 10;         // Randkugeln sind gefährdet
      let friends = 0;
      for (let d = 0; d < 6; d++) { const n = R.NB[i * 6 + d]; if (n >= 0 && b[n] === col) friends++; }
      v += friends * 4;                     // Zusammenhalt
      c += sign * v;
    }
    return score + c;
  }

  const order = (m) => (m.off ? 100 : m.push.length ? 50 : m.kind === 'inline' ? 10 : m.kind === 'side' ? 5 : 0) + Math.random();

  function search(s, depth, alpha, beta, me, ctx) {
    const w = R.winner(s);
    if (w) return (w === s.turn ? WIN : -WIN) + (w === s.turn ? -s.ply : s.ply);
    if (depth === 0) return evaluate(s, s.turn);
    if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.timeout = true; return 0; }
    const moves = R.legalMoves(s);
    if (!moves.length) return -WIN;
    moves.sort((a, b) => order(b) - order(a));
    let best = -Infinity;
    for (const m of moves) {
      const v = -search(R.applyMove(s, m), depth - 1, -beta, -alpha, me, ctx);
      if (ctx.timeout) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = { easy: { depth: 1, noise: 60, ms: 500 }, medium: { depth: 3, noise: 8, ms: 1500 }, hard: { depth: 5, noise: 0, ms: 3500 } };

  function bestMove(s, level) {
    const cfg = LEVELS[level] || LEVELS.medium;
    const moves = R.legalMoves(s);
    if (!moves.length) return null;
    let scored = moves.map((m) => ({ m, v: 0 }));
    const ctx = { nodes: 0, timeout: false, deadline: Date.now() + cfg.ms };
    for (let depth = 1; depth <= cfg.depth; depth++) {
      let alpha = -Infinity;
      const next = [];
      scored.sort((a, b) => b.v - a.v || order(b.m) - order(a.m));
      for (const e of scored) {
        const v = -search(R.applyMove(s, e.m), depth - 1, -Infinity, -alpha, s.turn, ctx);
        if (ctx.timeout) break;
        next.push({ m: e.m, v });
        if (v > alpha) alpha = v;
      }
      if (ctx.timeout) break;
      scored = next;
    }
    scored.forEach((e) => { e.v += (Math.random() - 0.5) * 2 * cfg.noise; });
    scored.sort((a, b) => b.v - a.v);
    return scored[0].m;
  }

  return { bestMove, evaluate, LEVELS };
});
