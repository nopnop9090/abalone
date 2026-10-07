/* SVG-Brett: Rendering, Animation, Markierungen. */
(function () {
  const R = AbaloneRules;
  const NS = 'http://www.w3.org/2000/svg';
  const S = 34, SP = S * Math.sqrt(3); // Zellabstand
  const MR = SP * 0.43;                // Kugelradius
  const HR = SP * 0.46;                // Mulden-Radius
  const OUTER = 4 * SP + 38;           // Umkreis des Brettes
  const el = (n, a = {}, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };

  class BoardView {
    constructor(svg, handlers) {
      this.svg = svg; this.h = handlers || {}; this.flip = false;
      this.marbles = new Map(); this.cellEls = new Map();
      const pad = OUTER + 46;
      svg.setAttribute('viewBox', `${-pad} ${-pad * 0.9} ${pad * 2} ${pad * 1.8}`);
      this._defs(); this._build();
    }
    pos(i) {
      const q = R.qOf(i), r = R.rOf(i);
      let x = SP * (q + r / 2), y = S * 1.5 * r;
      if (this.flip) { x = -x; y = -y; }
      return [x, y];
    }
    _defs() {
      const d = el('defs', {}, this.svg);
      const grad = (id, stops, a = {}) => { const g = el('radialGradient', { id, ...a }, d); stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g)); };
      grad('gBlack', [[0, '#8a8f9c'], [0.18, '#3a3d48'], [0.6, '#0f1015'], [1, '#000']], { cx: '.35', cy: '.3', r: '.8' });
      grad('gWhite', [[0, '#fff'], [0.35, '#ecebe6'], [0.8, '#b9b6ab'], [1, '#8f8c82']], { cx: '.35', cy: '.3', r: '.85' });
      grad('gHole', [[0, '#1c1209'], [0.75, '#2c1c10'], [1, '#4a3320']], { cx: '.5', cy: '.55', r: '.55' });
      grad('gBoard', [[0, '#8a5a34'], [1, '#4f3019']], { cx: '.4', cy: '.3', r: '.9' });
      const f = el('filter', { id: 'fShadow', x: '-30%', y: '-30%', width: '170%', height: '170%' }, d);
      el('feDropShadow', { dx: 2, dy: 5, stdDeviation: 3.2, 'flood-color': '#000', 'flood-opacity': '.55' }, f);
      const f2 = el('filter', { id: 'fBoard', x: '-10%', y: '-10%', width: '120%', height: '125%' }, d);
      el('feDropShadow', { dx: 0, dy: 14, stdDeviation: 14, 'flood-color': '#000', 'flood-opacity': '.6' }, f2);
    }
    _build() {
      const s = this.svg;
      const pts = (rad) => [0, 1, 2, 3, 4, 5].map((k) => [rad * Math.cos(k * Math.PI / 3), rad * Math.sin(k * Math.PI / 3)].join(',')).join(' ');
      el('polygon', { points: pts(OUTER), fill: 'url(#gBoard)', stroke: '#3a2412', 'stroke-width': 26, 'stroke-linejoin': 'round', filter: 'url(#fBoard)' }, s);
      el('polygon', { points: pts(OUTER), fill: 'url(#gBoard)', stroke: '#9a6a3f', 'stroke-width': 6, 'stroke-linejoin': 'round', opacity: .9 }, s);
      el('polygon', { points: pts(OUTER - 14), fill: 'none', stroke: '#2a180b', 'stroke-width': 3, 'stroke-linejoin': 'round', opacity: .55 }, s);
      this.gHoles = el('g', {}, s); this.gLabels = el('g', { class: 'labels' }, s);
      this.gGhost = el('g', {}, s); this.gMarbles = el('g', {}, s); this.gMarks = el('g', {}, s); this.gHit = el('g', {}, s);
      for (const i of R.CELLS) {
        const [x, y] = this.pos(i);
        const hole = el('circle', { r: HR, fill: 'url(#gHole)', stroke: '#6b4a2c', 'stroke-width': 1.5 }, this.gHoles);
        const hl = el('circle', { r: HR, fill: 'none', stroke: '#000', 'stroke-opacity': .35, 'stroke-width': 3, transform: 'translate(0,1.5)', 'clip-path': '' }, this.gHoles);
        const hit = el('circle', { r: SP * 0.5, fill: 'transparent', class: 'hit', 'data-i': i }, this.gHit);
        hit.addEventListener('click', () => this.h.click && this.h.click(i));
        hit.addEventListener('mouseenter', () => this.h.hover && this.h.hover(i));
        hit.addEventListener('mouseleave', () => this.h.hover && this.h.hover(-1));
        this.cellEls.set(i, { hole, hl, hit });
      }
      this._labels(); this._layoutCells();
    }
    _layoutCells() {
      for (const [i, c] of this.cellEls) {
        const [x, y] = this.pos(i);
        c.hole.setAttribute('cx', x); c.hole.setAttribute('cy', y);
        c.hl.setAttribute('cx', x); c.hl.setAttribute('cy', y);
        c.hit.setAttribute('cx', x); c.hit.setAttribute('cy', y);
      }
    }
    _labels() {
      this.gLabels.innerHTML = '';
      const f = this.flip ? -1 : 1;
      for (let r = -4; r <= 4; r++) { // Buchstaben links der Reihen
        const first = R.idxOf(Math.max(-4, -4 - r), r), [x, y] = this.pos(first);
        const t = el('text', { x: x - f * SP * 0.95, y: y + 5, 'text-anchor': 'middle' }, this.gLabels);
        t.textContent = String.fromCharCode(65 + (4 - r));
      }
      for (let q = -4; q <= 4; q++) { // Zahlen an der unteren Kante (bei gedrehtem Brett oben)
        const cell = R.idxOf(q, q <= 0 ? 4 : 4 - q);
        const [x, y] = this.pos(cell);
        const t = el('text', { x: x + f * (q > 0 ? SP * 0.45 : 0), y: y + f * SP * 0.95 + 5, 'text-anchor': 'middle' }, this.gLabels);
        t.textContent = q + 5;
      }
    }
    setFlip(f) {
      this.flip = !!f; this._layoutCells(); this._labels();
      for (const [i, g] of this.marbles) this._place(g, i);
      this.setLast(this._last || []);
    }
    _place(g, i) { const [x, y] = this.pos(i); g.style.transform = `translate(${x}px,${y}px)`; }
    _marble(color) {
      const g = el('g', { class: 'marble' });
      el('circle', { r: MR, fill: '#000', opacity: 0, filter: 'url(#fShadow)', class: 'shadow' }, g).setAttribute('opacity', 0.0);
      el('circle', { r: MR, fill: color === 1 ? 'url(#gBlack)' : 'url(#gWhite)', filter: 'url(#fShadow)', class: 'ball' }, g);
      el('ellipse', { cx: -MR * 0.3, cy: -MR * 0.42, rx: MR * 0.38, ry: MR * 0.22, fill: '#fff', opacity: color === 1 ? 0.35 : 0.85, transform: 'rotate(-25)' }, g);
      el('circle', { r: MR + 3, fill: 'none', class: 'selring' }, g);
      return g;
    }
    // Brett komplett neu aufbauen
    setState(state) {
      for (const g of this.marbles.values()) g.remove();
      this.marbles.clear();
      for (const i of R.CELLS) {
        const c = state.board[i]; if (!c) continue;
        const g = this._marble(c); g.dataset.c = c;
        g.style.transition = 'none'; this._place(g, i); this.gMarbles.appendChild(g);
        this.marbles.set(i, g);
        requestAnimationFrame(() => { g.style.transition = ''; });
      }
      this.clearMarks();
    }
    animate(steps, dir) {
      const moved = steps.map((st) => ({ st, g: this.marbles.get(st.from) }));
      for (const m of moved) this.marbles.delete(m.st.from);
      for (const { st, g } of moved) {
        if (!g) continue;
        if (st.to >= 0) { this._place(g, st.to); this.marbles.set(st.to, g); }
        else { // über den Rand
          const [x, y] = this.pos(st.from);
          const dq = R.DQ[dir], dr = R.DR[dir];
          let dx = SP * (dq + dr / 2), dy = S * 1.5 * dr; if (this.flip) { dx = -dx; dy = -dy; }
          g.style.transform = `translate(${x + dx * 1.1}px,${y + dy * 1.1 + 6}px) scale(.55)`;
          g.style.opacity = 0; g.style.zIndex = 0;
          setTimeout(() => g.remove(), 700);
        }
      }
      this.gMarbles.querySelectorAll('.marble').forEach((g) => g.classList.remove('sel'));
    }
    clearMarks() { this.gMarks.innerHTML = ''; this.gGhost.innerHTML = ''; for (const g of this.marbles.values()) g.classList.remove('sel'); }
    setSelection(cells) {
      for (const [i, g] of this.marbles) g.classList.toggle('sel', cells.includes(i));
    }
    setTargets(list) { // [{cell, push}]
      this.gMarks.innerHTML = '';
      for (const t of list) {
        const [x, y] = this.pos(t.cell);
        const c = el('circle', { cx: x, cy: y, r: t.push ? MR * 0.95 : MR * 0.55, class: 'target' + (t.push ? ' push' : '') }, this.gMarks);
        c.style.pointerEvents = 'none';
      }
    }
    setGhost(cells) {
      this.gGhost.innerHTML = '';
      for (const i of cells) { const [x, y] = this.pos(i); el('circle', { cx: x, cy: y, r: MR * 0.9, class: 'ghost' }, this.gGhost); }
    }
    setLast(cells) {
      this._last = cells;
      for (const c of this.cellEls.values()) c.hole.classList.remove('last');
      for (const i of cells) this.cellEls.get(i) && this.cellEls.get(i).hole.classList.add('last');
    }
  }
  window.BoardView = BoardView;
})();
