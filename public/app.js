/* Abalone-Client: Menü, Spielsteuerung (Computer / LLM / lokal / online). */
(function () {
  const R = AbaloneRules, L = AbaloneLLM;
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
  for (const [id, k, d] of [['llmUrl', 'llmUrl', 'https://api.openai.com/v1'], ['llmKey', 'llmKey', ''], ['llmModel', 'llmModel', 'gpt-4o-mini']]) {
    $(id).value = store.get(k, d); $(id).addEventListener('input', () => store.set(k, $(id).value.trim()));
  }
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
    if (G.mode === 'online') return G.ws && G.ws.send(JSON.stringify({ t: 'rematch' }));
    startLocalGame();
  };

  // ---------- Spielstart ----------
  function newGame(opts) {
    if (G) closeGame();
    G = Object.assign({ state: R.setup(opts.layout), history: [], stack: [], over: null, busy: false, sel: [], anchors: new Map(), moves: null, mode: 'ai', human: 0, worker: null }, opts);
    G.moves = R.legalMoves(G.state);
    view.setFlip(G.flip); view.setState(G.state); view.setLast([]);
    $('onlineCard').hidden = G.mode !== 'online'; $('llmLogCard').hidden = G.mode !== 'llm'; $('llmLog').textContent = '';
    $('btnUndo').hidden = G.mode === 'online'; $('btnResign').hidden = G.mode === 'local';
    updateUI(); maybeBot();
  }
  function startLocalGame() {
    let human = cfg.color || (Math.random() < 0.5 ? 1 : 2);
    if (cfg.mode === 'local') human = 0;
    newGame({ mode: cfg.mode, layout: cfg.layout, human, level: cfg.level, flip: cfg.mode === 'local' ? false : human === 2 });
  }
  function closeGame() { if (G.worker) G.worker.terminate(); if (G.ws) { G.noReconnect = true; G.ws.close(); } G.dead = true; G = null; }

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
    if (G.mode === 'online') { G.ws.send(JSON.stringify({ t: 'move', marbles: mv.marbles, dir: mv.dir })); G.sel = []; refreshSel(); return; }
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
    if (G.mode === 'ai') askAI(token, G.level, done);
    else askLLM(token, done);
  }
  function askAI(token, level, cb) {
    if (!token.worker) token.worker = new Worker('/ai-worker.js');
    token.worker.onmessage = (e) => cb(e.data && R.findMove(token.state, e.data.marbles, e.data.dir));
    token.worker.postMessage({ state: R.serialize(token.state), level });
  }
  async function askLLM(token, cb) {
    const moves = token.moves, url = store.get('llmUrl', ''), key = store.get('llmKey', ''), model = store.get('llmModel', '');
    let note = '', log = $('llmLog');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        log.textContent = attempt ? `Neuer Versuch (${attempt + 1}/3) …` : 'LLM denkt nach …';
        const r = await fetch('/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, key, model, messages: L.buildMessages(token.state, moves, note) }) });
        const txt = await r.text();
        let data; try { data = JSON.parse(txt); } catch (e) { throw new Error(txt.slice(0, 200)); }
        if (!r.ok) throw new Error((data.error && (data.error.message || data.error)) || ('HTTP ' + r.status));
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        const p = L.parseReply(content, moves.length);
        if (token !== G) return;
        if (p) { log.textContent = `${R.moveText(moves[p.index])}${p.reason ? ' – ' + p.reason : ''}`; return cb(moves[p.index]); }
        note = 'Deine letzte Antwort war ungültig. Antworte NUR mit {"move": <Nummer aus der Liste>}.';
      } catch (e) {
        if (token !== G) return;
        log.textContent = 'LLM-Fehler: ' + e.message; note = '';
        if (/HTTP 4\d\d|401|403|Ungültige URL|Upstream/.test(e.message)) break;
      }
    }
    toast('LLM-Antwort ungültig – Computer spielt diesen Zug');
    askAI(token, 'medium', cb);
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
    if (G.mode === 'online') return G.ws.send(JSON.stringify({ t: 'resign' }));
    G.over = { winner: R.other(G.human), reason: 'resign' }; updateUI();
  };

  // ---------- Anzeige ----------
  function pipsHTML(n, color) { return Array.from({ length: 6 }, (_, k) => `<i class="pip ${k < n ? 'f ' + (color === 1 ? 'b' : 'w') : ''}"></i>`).join(''); }
  function playerName(c) {
    if (!G) return NAMES[c];
    if (G.mode === 'ai') return c === G.human ? `Du (${NAMES[c]})` : `Computer (${NAMES[c]})`;
    if (G.mode === 'llm') return c === G.human ? `Du (${NAMES[c]})` : `LLM (${NAMES[c]})`;
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
    else if (G.busy) st = (G.mode === 'llm' ? 'LLM' : 'Computer') + ' denkt nach …';
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

  // ---------- Online ----------
  let pub = '';
  async function loadInfo() { try { const r = await (await fetch('/api/info')).json(); pub = r.publicUrl || ''; return r; } catch (e) { return {}; } }
  function wsURL() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
  function connect(first) {
    const ws = new WebSocket(wsURL());
    ws.onopen = () => ws.send(JSON.stringify(first));
    ws.onmessage = (e) => onServer(JSON.parse(e.data), ws);
    ws.onclose = () => {
      const g = G;
      if (!g || g.ws !== ws || g.noReconnect) return;
      $('conn').textContent = 'Verbindung verloren – verbinde neu …';
      setTimeout(() => { if (G === g && !g.noReconnect) g.ws = connect({ t: 'join', room: g.room, token: store.get('tok_' + g.room, '') }); }, 1500);
    };
    return ws;
  }
  async function createOnline() {
    await loadInfo();
    const ws = connect({ t: 'create', layout: cfg.layout, color: cfg.color === 1 ? 'b' : cfg.color === 2 ? 'w' : 'r' });
    newGame({ mode: 'online', layout: cfg.layout, human: 0, ws, flip: false, room: '' });
  }
  async function joinOnline(code) {
    await loadInfo();
    const ws = connect({ t: 'join', room: code, token: store.get('tok_' + code, '') });
    newGame({ mode: 'online', layout: 'standard', human: 0, ws, flip: false, room: code });
  }
  function shareLink() {
    let base = pub || location.origin;
    return base + '/?room=' + G.room;
  }
  function onServer(m, ws) {
    if (!G || G.ws !== ws) return;
    if (m.t === 'error') { toast(m.msg || 'Fehler'); if (m.code === 'noroom') { toast('Raum nicht gefunden'); closeGame(); $('overlay').hidden = false; history.replaceState(null, '', '/'); } return; }
    if (m.t === 'joined') {
      G.room = m.room; G.human = m.color;
      if (m.token) store.set('tok_' + m.room, m.token);
      $('roomCode').textContent = m.room; history.replaceState(null, '', '/?room=' + m.room);
      return;
    }
    if (m.t === 'sync') {
      G.room = m.room; G.human = m.color; G.layout = m.layout;
      G.state = R.deserialize(m.state); G.moves = m.over ? [] : R.legalMoves(G.state);
      G.over = m.over; G.rematch = m.rematch; G.bothHere = m.players[1] && m.players[2];
      G.history = m.history.map((h) => ({ text: h.marbles.map(R.label).join(',') + ' ' + R.DIR_NAMES[h.dir], by: h.by }));
      G.sel = []; G.anchors = new Map(); G.stack = [];
      const flip = G.human === 2;
      view.setFlip(flip); G.flip = flip; view.setState(G.state);
      const lastH = m.history[m.history.length - 1]; view.setLast(lastH ? lastCells(lastH) : []);
      $('conn').textContent = G.bothHere ? 'Beide Spieler verbunden.' : 'Mitspieler nicht verbunden.';
      $('roomCode').textContent = m.room;
      $('shareUrl').value = shareLink();
      const local = /^(localhost|127\.|\[::1\])/.test(new URL($('shareUrl').value).hostname);
      $('pubWarn').hidden = !local;
      $('shareBox').hidden = !!G.bothHere;
      if (!m.over) $('over').hidden = true;
      updateUI(); return;
    }
    if (m.t === 'move') {
      const mv = R.findMove(G.state, m.marbles, m.dir);
      if (!mv) return;
      G.bothHere = true; commit(mv, m.by); G.over = m.over || G.over; G.rematch = {}; updateUI(); return;
    }
  }
  $('btnCopy').onclick = async () => { try { await navigator.clipboard.writeText($('shareUrl').value); toast('Link kopiert'); } catch (e) { $('shareUrl').select(); document.execCommand('copy'); toast('Link kopiert'); } };
  $('btnShare').onclick = () => { if (navigator.share) navigator.share({ title: 'Abalone', text: 'Spiel mit mir Abalone!', url: $('shareUrl').value }).catch(() => {}); else $('btnCopy').click(); };
  $('btnPub').onclick = async () => {
    const u = $('pubInput').value.trim();
    const r = await fetch('/api/public-url', { method: 'POST', body: JSON.stringify({ url: u }) });
    if (r.ok) { pub = (await r.json()).publicUrl; $('shareUrl').value = shareLink(); $('pubWarn').hidden = !!pub; toast('Öffentliche URL gesetzt'); }
  };

  // ---------- Start ----------
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) { cfg.mode = 'online'; $('overlay').hidden = true; joinOnline(roomParam.toUpperCase()); }
  else { newGame({ mode: 'local', layout: 'standard', human: 0, flip: false }); }
  window.__abalone = { get G() { return G; }, view, R };
})();
