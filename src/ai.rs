//! Computer-Gegner: Negamax mit Alpha-Beta und Iterative Deepening (Port von shared/ai.js).
use crate::rules::*;
use std::time::{Duration, Instant};

const WIN: f64 = 1e6;

pub struct Rng(pub u64);
impl Rng {
    pub fn from_time() -> Rng {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
        Rng(t | 1)
    }
    pub fn next_f64(&mut self) -> f64 {
        self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

pub fn evaluate(s: &State, me: u8) -> f64 {
    let opp = other(me);
    let mut score = 1000.0 * (s.out[opp as usize] as f64 - s.out[me as usize] as f64);
    for &i in cells() {
        let col = s.board[i];
        if col == 0 { continue; }
        let sign = if col == me { 1.0 } else { -1.0 };
        let mut v = (4 - dist(i)) as f64 * 6.0;
        if dist(i) == 4 { v -= 10.0; }
        let friends = (0..6).filter(|&d| matches!(nb(i, d), Some(n) if s.board[n] == col)).count();
        v += friends as f64 * 4.0;
        score += sign * v;
    }
    score
}

fn order(m: &Move, rng: &mut Rng) -> f64 {
    let base = if m.off { 100.0 } else if !m.push.is_empty() { 50.0 } else {
        match m.kind { Kind::Inline => 10.0, Kind::Side => 5.0, _ => 0.0 }
    };
    base + rng.next_f64()
}

struct Ctx { nodes: u32, timeout: bool, deadline: Instant, rng: Rng }

fn ordered(s: &State, rng: &mut Rng) -> Vec<Move> {
    let mut v: Vec<(f64, Move)> = legal_moves(s).into_iter().map(|m| (order(&m, rng), m)).collect();
    v.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    v.into_iter().map(|x| x.1).collect()
}

fn search(s: &State, depth: u32, mut alpha: f64, beta: f64, ctx: &mut Ctx) -> f64 {
    let w = winner(s);
    if w != 0 { return if w == s.turn { WIN - s.ply as f64 } else { -WIN + s.ply as f64 }; }
    if depth == 0 { return evaluate(s, s.turn); }
    ctx.nodes += 1;
    if ctx.nodes & 1023 == 0 && Instant::now() > ctx.deadline { ctx.timeout = true; return 0.0; }
    let moves = ordered(s, &mut ctx.rng);
    if moves.is_empty() { return -WIN; }
    let mut best = f64::NEG_INFINITY;
    for m in &moves {
        let v = -search(&apply_move(s, m), depth - 1, -beta, -alpha, ctx);
        if ctx.timeout { return 0.0; }
        if v > best { best = v; }
        if v > alpha { alpha = v; }
        if alpha >= beta { break; }
    }
    best
}

/// (Tiefe, Rauschen, Zeitlimit in ms)
pub fn level_config(level: &str) -> (u32, f64, u64) {
    match level { "easy" => (1, 60.0, 500), "hard" => (5, 0.0, 3500), _ => (3, 8.0, 1500) }
}

pub fn best_move(s: &State, level: &str) -> Option<Move> {
    let (max_depth, noise, ms) = level_config(level);
    let mut ctx = Ctx { nodes: 0, timeout: false, deadline: Instant::now() + Duration::from_millis(ms), rng: Rng::from_time() };
    let moves = legal_moves(s);
    if moves.is_empty() { return None; }
    let mut scored: Vec<(Move, f64)> = moves.into_iter().map(|m| (m, 0.0)).collect();
    for depth in 1..=max_depth {
        let mut alpha = f64::NEG_INFINITY;
        let mut keyed: Vec<(f64, f64, Move)> = scored.into_iter().map(|(m, v)| (v, order(&m, &mut ctx.rng), m)).collect();
        keyed.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(b.1.partial_cmp(&a.1).unwrap()));
        let prev: Vec<(Move, f64)> = keyed.iter().map(|k| (k.2.clone(), k.0)).collect();
        let mut next = Vec::new();
        for (_, _, m) in &keyed {
            let v = -search(&apply_move(s, m), depth - 1, f64::NEG_INFINITY, -alpha, &mut ctx);
            if ctx.timeout { break; }
            next.push((m.clone(), v));
            if v > alpha { alpha = v; }
        }
        if ctx.timeout { scored = prev; break; }
        scored = next;
    }
    // Rauschen nur für Stellungsbewertungen, nie für erzwungene Gewinne/Verluste
    for e in scored.iter_mut() { if e.1.abs() < WIN / 2.0 { e.1 += (ctx.rng.next_f64() - 0.5) * 2.0 * noise; } }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    scored.into_iter().next().map(|e| e.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn takes_winning_push() {
        let mut s = State { board: [0; N], out: [0, 0, 5], turn: BLACK, ply: 0 };
        for (l, c) in [("E7", 1), ("E8", 1), ("E9", 2), ("A1", 2)] { s.board[parse_label(l).unwrap()] = c; }
        let m = best_move(&s, "medium").unwrap();
        assert!(m.off);
    }
    #[test]
    fn plays_legal_moves_from_start() {
        let s = setup("standard");
        let m = best_move(&s, "easy").unwrap();
        assert!(find_move(&s, &m.marbles, m.dir).is_some());
    }
}
