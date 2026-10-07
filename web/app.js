/* Abalone-Client: Menü, Spielsteuerung (Computer / lokal / online). */
(function () {
  const R = AbaloneRules;
  const $ = (id) => document.getElementById(id);
  const NAMES = { 1: 'Schwarz', 2: 'Weiß' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  const view = new BoardView($('board'), { click: onCell, hover: onHover });
  const cfg = { mode: 'ai', color: 1, level: 'medium', layout: 'standard' };
  let G = null; // laufendes Spiel

  // ---------- Hilfen ----------
  let toastT;
  function toast(msg, ms = 2800) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
  const lastCells = (mv) => mv ? mv.marbles.concat(mv.marbles.map((i) => R.NB[i * 6 + mv.dir]).filter((x) => x >= 0)) : [];

  // ---------- Menü ----------
  const seg = (id, key, conv = (x) => x) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$(id).children].forEach((c) => c.classList.toggle('on', c === b)); cfg[key] = conv(b.dataset.v);
  });
  seg('optColor', 'color', Number); seg('optLevel', 'level'); seg('optLayout', 'layout');
  $('modeTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('modeTabs').children].forEach((c) => c.classList.toggle('on', c === b)); cfg.mode = b.dataset.mode; refreshOpts();
  });
  function refreshOpts() { document.querySelectorAll('.opt').forEach((o) => { o.hidden = !o.dataset.for.split(',').includes(cfg.mode); }); }
  refreshOpts();
  $('btnMenu').onclick = () => { $('overlay').hidden = false; $('btnClose').hidden = !G; };
  $('btnClose').onclick = () => { $('overlay').hidden = true; };
  $('btnToMenu').onclick = () => { $('over').hidden = true; $('overlay').hidden = false; $('btnClose').hidden = !G; };
  $('btnStart').onclick = () => {
    $('overlay').hidden = true;
    if (cfg.mode === 'online') {
      const code = $('joinCode').value.trim().toUpperCase();
      return code ? joinOnline(code) : createOnline();
    }
    startLocalGame();
  };
  $('btnAgain').onclick = () => {
    $('over').hidden = true;
    if (G.mode === 'online') return post('rematch');
    startLocalGame();
  };

  // ---------- Spielstart ----------
  function newGame(opts) {
    if (G) closeGame();
    G = Object.assign({ state: R.setup(opts.layout), history: [], stack: [], over: null, busy: false, sel: [], anchors: new Map(), moves: null, mode: 'ai', human: 0 }, opts);
    G.moves = R.legalMoves(G.state);
    view.setFlip(G.flip); view.setState(G.state); view.setLast([]);
    $('onlineCard').hidden = G.mode !== 'online';
    $('btnUndo').hidden = G.mode === 'online'; $('btnResign').hidden = G.mode === 'local';
    updateUI(); maybeBot();
  }
  function startLocalGame() {
    let human = cfg.color || (Math.random() < 0.5 ? 1 : 2);
    if (cfg.mode === 'local') human = 0;
    newGame({ mode: cfg.mode, layout: cfg.layout, human, level: cfg.level, flip: cfg.mode === 'local' ? false : human === 2 });
  }
  function closeGame() { G.dead = true; G = null; }

  // ---------- Eingabe ----------
  const canMove = () => G && !G.over && !G.busy && G.state && (
    G.mode === 'local' || (G.mode === 'online' ? G.state.turn === G.human && G.bothHere : G.state.turn === G.human));

  function chain(list) { // geordnete Kette entlang einer Achse oder null
    if (list.length === 1) return list;
    for (const a of [0, 2, 4]) {
      const s = list.slice();
      let start = s.find((x) => !s.includes(R.NB[x * 6 + (a ^ 1)]) || R.NB[x * 6 + (a ^ 1)] < 0);
      if (start === undefined) continue;
      const out = [start];
      while (out.length < s.length) { const n = R.NB[out[out.length - 1] * 6 + a]; if (n < 0 || !s.includes(n)) break; out.push(n); }
      if (out.length === s.length) return out;
    }
    return null;
  }
  function onCell(i) {
    if (!canMove()) return;
    const own = G.state.board[i] === G.state.turn;
    if (G.anchors.has(i)) return play(G.anchors.get(i));
    if (!own) { G.sel = []; return refreshSel(); }
    if (G.sel.includes(i)) {
      if (G.sel.length === 1) G.sel = [];
      else { const rest = G.sel.filter((x) => x !== i); G.sel = chain(rest) ? rest : [i]; }
    } else {
      const ext = G.sel.concat(i);
      G.sel = ext.length <= 3 && chain(ext) ? chain(ext) : [i];
    }
    refreshSel();
  }
  function refreshSel() {
    G.anchors = new Map(); const marks = [];
    view.setSelection(G.sel); view.setGhost([]);
    if (G.sel.length) {
      const key = G.sel.slice().sort((a, b) => a - b).join();
      for (const m of G.moves) {
        if (m.marbles.slice().sort((a, b) => a - b).join() !== key) continue;
        const cell = anchorOf(m);
        G.anchors.set(cell, m); marks.push({ cell, push: m.kind === 'sumito' });
      }
      if (!marks.length && G.sel.length > 1) toast('Mit dieser Auswahl ist kein Zug möglich');
    }
    view.setTargets(marks);
  }
  function anchorOf(m) {
    if (m.kind === 'side' || m.kind === 'single') return R.NB[m.marbles[0] * 6 + m.dir];
    const lead = m.dir === m.axis ? m.marbles[m.marbles.length - 1] : m.marbles[0];
    return R.NB[lead * 6 + m.dir];
  }
  function onHover(i) {
    if (!G || !G.anchors || !G.anchors.has(i)) return view.setGhost([]);
    const m = G.anchors.get(i);
    view.setGhost(m.marbles.map((x) => R.NB[x * 6 + m.dir]).concat(m.push.map((x) => R.NB[x * 6 + m.dir])).filter((x) => x >= 0));
  }

  // ---------- Zug ausführen ----------
  function play(mv) {
    if (G.mode === 'online') { post('move', { marbles: mv.marbles, dir: mv.dir }); G.sel = []; refreshSel(); return; }
    commit(mv);
    maybeBot();
  }
  function commit(mv, by) {
    G.stack.push(G.state);
    const next = R.applyMove(G.state, mv);
    const who = G.state.turn;
    G.history.push({ text: R.moveText(mv), by: by || who });
    G.state = next; G.moves = null; G.sel = [];
    view.animate(next.steps, mv.dir); view.setLast(lastCells(mv)); view.setTargets([]); view.setGhost([]);
    const w = R.winner(next);
    if (w && !G.over) G.over = { winner: w, reason: 'captured' };
    G.moves = G.over ? [] : R.legalMoves(next); G.anchors = new Map();
    updateUI();
    if (mv.kind === 'sumito' && mv.off) toast('Kugel herausgeschoben!');
  }

  // ---------- Bots ----------
  function maybeBot() {
    if (!G || G.over || G.mode === 'local' || G.mode === 'online') return;
    if (G.state.turn === G.human) return;
    G.busy = true; updateUI();
    const token = G;
    const done = (mv) => {
      if (G !== token || G.dead) return;
      G.busy = false;
      if (!mv) { G.over = { winner: G.human, reason: 'nomoves' }; return updateUI(); }
      setTimeout(() => { if (G === token) { commit(mv); } }, 150);
    };
    askAI(token, G.level, done);
  }
  async function askAI(token, level, cb) {
    try {
      const r = await fetch('/api/ai', { method: 'POST', body: JSON.stringify({ state: R.serialize(token.state), level }) });
      const m = await r.json();
      cb(m && R.findMove(token.state, m.marbles, m.dir));
    } catch (e) { if (token === G) { toast('Computer nicht erreichbar: ' + e.message); token.busy = false; updateUI(); } }
  }

  // ---------- Undo / Aufgeben / Drehen ----------
  $('btnUndo').onclick = () => {
    if (!G || G.mode === 'online' || !G.stack.length || G.busy) return;
    let n = G.mode === 'local' ? 1 : (G.state.turn === G.human ? 2 : 1);
    n = Math.min(n, G.stack.length);
    while (n--) { G.state = G.stack.pop(); G.history.pop(); }
    G.over = null; G.moves = R.legalMoves(G.state); G.sel = []; G.anchors = new Map();
    view.setState(G.state); view.setLast([]); updateUI(); maybeBot();
  };
  $('btnFlip').onclick = () => { if (G) { G.flip = !G.flip; view.setFlip(G.flip); updateUI(); } };
  $('btnResign').onclick = () => {
    if (!G || G.over || !confirm('Wirklich aufgeben?')) return;
    if (G.mode === 'online') return post('resign');
    G.over = { winner: R.other(G.human), reason: 'resign' }; updateUI();
  };

  // ---------- Anzeige ----------
  function pipsHTML(n, color) { return Array.from({ length: 6 }, (_, k) => `<i class="pip ${k < n ? 'f ' + (color === 1 ? 'b' : 'w') : ''}"></i>`).join(''); }
  function playerName(c) {
    if (!G) return NAMES[c];
    if (G.mode === 'ai') return c === G.human ? `Du (${NAMES[c]})` : `Computer (${NAMES[c]})`;
    if (G.mode === 'online') return c === G.human ? `Du (${NAMES[c]})` : G.human ? `Gegner (${NAMES[c]})` : NAMES[c];
    return NAMES[c];
  }
  function updateUI() {
    if (!G) return;
    const s = G.state;
    // Tablett: unten = unten liegende Seite (Weiß bei normaler Ansicht, Schwarz gedreht)
    const bottom = G.flip ? 1 : 2, top = R.other(bottom);
    for (const [elId, c] of [['trayTop', top], ['trayBottom', bottom]]) {
      const t = $(elId);
      t.querySelector('.who').textContent = playerName(c);
      // Punkte = vom Spieler c herausgeschobene gegnerische Kugeln
      t.querySelector('.pips').innerHTML = pipsHTML(s.out[R.other(c)], R.other(c));
      t.classList.toggle('active', !G.over && s.turn === c);
    }
    let st, sub = '';
    if (G.over) {
      st = `${NAMES[G.over.winner]} gewinnt!`;
      sub = G.over.reason === 'resign' ? 'durch Aufgabe' : '';
      showOver();
    } else if (G.mode === 'online' && !G.bothHere) { st = 'Warte auf Mitspieler …'; sub = G.human ? 'Teile den Link rechts.' : ''; }
    else if (G.busy) st = 'Computer denkt nach …';
    else { st = `${playerName(s.turn)} ist am Zug`; if (canMove()) sub = 'Kugel(n) anklicken, dann Ziel wählen'; }
    $('status').textContent = st; $('sub').textContent = sub;
    $('moves').innerHTML = G.history.map((h) => `<li>${h.text}</li>`).join('');
    $('moves').scrollTop = 1e6;
    $('btnUndo').disabled = !G.stack.length || G.busy;
    $('btnResign').disabled = !!G.over || G.human === 0 && G.mode === 'online';
  }
  function showOver() {
    const w = G.over.winner;
    const mine = G.human ? (w === G.human) : null;
    $('overTitle').textContent = mine === null ? `${NAMES[w]} gewinnt!` : mine ? '🎉 Du hast gewonnen!' : 'Du hast verloren';
    $('overText').textContent = G.over.reason === 'resign' ? 'Aufgabe' : `${NAMES[w]} hat 6 Kugeln herausgeschoben.`;
    $('btnAgain').textContent = G.mode === 'online' ? (G.rematch && G.rematch[G.human] ? 'Warte auf Gegner …' : 'Revanche') : 'Nochmal';
    setTimeout(() => { if (G && G.over) $('over').hidden = false; }, 700);
  }

  // ---------- Online (HTTP/JSON, Long-Poll) ----------
  const api = async (method, path, body) => {
    const r = await fetch('/api/rooms' + path, { method, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { status: r.status });
    return j;
  };
  const tokenOf = (g) => store.get('tok_' + g.room, '');
  async function post(action, extra) {
    const g = G; if (!g || !g.room) return;
    try { applySync(g, await api('POST', `/${g.room}/${action}`, Object.assign({ token: tokenOf(g) }, extra))); }
    catch (e) { toast(e.message); }
  }
  async function pollLoop(g) {
    let since = 0;
    while (G === g && !g.dead) {
      try {
        const m = await api('GET', `/${g.room}?since=${since}&wait=25&token=${encodeURIComponent(tokenOf(g))}`);
        if (G !== g) return;
        since = m.version; applySync(g, m);
        $('conn').dataset.err = '';
      } catch (e) {
        if (G !== g) return;
        if (e.status === 404) { toast('Raum nicht gefunden'); closeGame(); $('overlay').hidden = false; history.replaceState(null, '', '/'); return; }
        $('conn').textContent = 'Verbindung verloren – verbinde neu …';
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  async function startOnline(g, first) {
    try {
      const m = await first();
      if (G !== g) return;
      g.room = m.room;
      if (m.token) store.set('tok_' + m.room, m.token);
      history.replaceState(null, '', '/?room=' + m.room);
      applySync(g, m);
      pollLoop(g);
    } catch (e) { toast(e.status === 404 ? 'Raum nicht gefunden' : e.message); if (G === g) { closeGame(); $('overlay').hidden = false; history.replaceState(null, '', '/'); } }
  }
  function createOnline() {
    newGame({ mode: 'online', layout: cfg.layout, human: 0, flip: false, room: '' });
    const g = G;
    startOnline(g, () => api('POST', '', { layout: cfg.layout, color: cfg.color === 1 ? 'b' : cfg.color === 2 ? 'w' : 'r' }));
  }
  function joinOnline(code) {
    newGame({ mode: 'online', layout: 'standard', human: 0, flip: false, room: code });
    const g = G;
    startOnline(g, () => api('POST', `/${code}/join`, { token: store.get('tok_' + code, '') }));
  }
  const shareLink = () => location.origin + '/?room=' + G.room;
  function applySync(g, m) {
    if (G !== g) return;
    const prev = g.state, prevLen = g.history.length, fresh = g.version === undefined;
    if (g.version !== undefined && m.version < g.version) return; // veraltete Antwort
    g.version = m.version;
    g.room = m.room; g.human = m.color; g.layout = m.layout;
    g.state = R.deserialize(m.state); g.moves = m.over ? [] : R.legalMoves(g.state);
    g.over = m.over; g.rematch = m.rematch; g.bothHere = m.players[1] && m.players[2] && m.seated[1] && m.seated[2];
    g.history = m.history.map((h) => ({ text: h.marbles.map(R.label).join(',') + ' ' + R.DIR_NAMES[h.dir], by: h.by }));
    g.sel = []; g.anchors = new Map(); g.stack = [];
    const flip = g.human === 2;
    g.flip = flip; view.setFlip(flip);
    const lastH = m.history[m.history.length - 1];
    const single = !fresh && m.history.length === prevLen + 1 && prev && prev.ply + 1 === g.state.ply;
    if (single && lastH) { // genau ein neuer Zug: animieren
      const mv = R.findMove(prev, lastH.marbles, lastH.dir);
      view.setState(prev);
      if (mv) { view.animate(R.applyMove(prev, mv).steps, mv.dir); if (mv.kind === 'sumito' && mv.off) toast('Kugel herausgeschoben!'); }
      else view.setState(g.state);
    } else view.setState(g.state);
    view.setLast(lastH ? lastCells(lastH) : []);
    view.setTargets([]); view.setGhost([]);
    $('conn').textContent = g.bothHere ? 'Beide Spieler verbunden.' : 'Mitspieler nicht verbunden.';
    $('roomCode').textContent = m.room;
    $('shareUrl').value = shareLink();
    $('shareBox').hidden = !!g.bothHere;
    if (!m.over) $('over').hidden = true;
    updateUI();
  }
  $('btnCopy').onclick = async () => { try { await navigator.clipboard.writeText($('shareUrl').value); toast('Link kopiert'); } catch (e) { $('shareUrl').select(); document.execCommand('copy'); toast('Link kopiert'); } };
  $('btnShare').onclick = () => { if (navigator.share) navigator.share({ title: 'Abalone', text: 'Spiel mit mir Abalone!', url: $('shareUrl').value }).catch(() => {}); else $('btnCopy').click(); };
  // ---------- Start ----------
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) { cfg.mode = 'online'; $('overlay').hidden = true; joinOnline(roomParam.toUpperCase()); }
  else { newGame({ mode: 'local', layout: 'standard', human: 0, flip: false }); }
  window.__abalone = { get G() { return G; }, view, R };
})();
