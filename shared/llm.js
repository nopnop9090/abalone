/* Prompt-Aufbau und Antwort-Parsing für den LLM-Gegner. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules'));
  else root.AbaloneLLM = factory(root.AbaloneRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  const RULES = `Du spielst Abalone (6 Kugeln des Gegners herausschieben gewinnt).
Brett: Reihen A (unten) bis I (oben), Spalten 1-9; Felder wie A1..A5, E1..E9, I5..I9.
Zeichen: X = Schwarz, O = Weiß, . = leer. Richtungen: O (rechts), W (links), NO (rechts oben), NW (links oben), SO (rechts unten), SW (links unten).
Ein Zug bewegt 1-3 eigene, zusammenhängende Kugeln einer Linie ein Feld weiter. Zug in Linienrichtung kann gegnerische Kugeln schieben (Überzahl nötig: 2 gegen 1, 3 gegen 1 oder 2); eine hinausgeschobene Kugel ist verloren.`;

  function buildMessages(state, moves, lastNote) {
    const me = state.turn, name = me === R.BLACK ? 'Schwarz (X)' : 'Weiß (O)';
    const list = moves.map((m, i) => `${i + 1}) ${R.moveText(m)}`).join('\n');
    const user = `${R.ascii(state)}\n\nVon dir herausgeschoben: ${state.out[R.other(me)]} / Vom Gegner herausgeschoben: ${state.out[me]}.\nDu bist ${name} und am Zug. Wähle genau einen der folgenden legalen Züge:\n${list}\n\n` +
      `Antworte NUR mit JSON: {"move": <Nummer>, "reason": "<kurze Begründung>"}.` + (lastNote ? `\nHinweis: ${lastNote}` : '');
    return [{ role: 'system', content: RULES + '\nBevorzuge Züge, die gegnerische Kugeln herausschieben, deine Kugeln vom Rand weg und zusammenhalten.' }, { role: 'user', content: user }];
  }

  function parseReply(text, count) {
    if (!text) return null;
    let n = null, reason = '';
    const j = /\{[\s\S]*?\}/.exec(text);
    if (j) { try { const o = JSON.parse(j[0]); n = parseInt(o.move, 10); reason = o.reason || ''; } catch (e) { /* fallthrough */ } }
    if (n === null || isNaN(n)) { const m = /"?move"?\s*[:=]\s*(\d+)/i.exec(text) || /^\s*(\d+)/.exec(text); if (m) n = +m[1]; }
    if (!n || n < 1 || n > count) return null;
    return { index: n - 1, reason };
  }
  return { buildMessages, parseReply };
});
