importScripts('/shared/rules.js', '/shared/ai.js');
onmessage = (e) => {
  const s = AbaloneRules.deserialize(e.data.state);
  const m = AbaloneAI.bestMove(s, e.data.level);
  postMessage(m ? { marbles: m.marbles, dir: m.dir } : null);
};
