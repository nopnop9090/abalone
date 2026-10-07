//! Abalone-Regeln. Felder: Index = (r+4)*9 + (q+4), axiale Koordinaten (Port von web/rules.js).
use std::sync::OnceLock;

pub const W: usize = 9;
pub const N: usize = 81;
pub const WIN_AT: u8 = 6;
pub const BLACK: u8 = 1;
pub const WHITE: u8 = 2;
/// Richtungen: 0 O, 1 W, 2 SO, 3 NW, 4 NO, 5 SW (d^1 = Gegenrichtung); r wächst nach unten.
pub const DQ: [i32; 6] = [1, -1, 0, 0, 1, -1];
pub const DR: [i32; 6] = [0, 0, 1, -1, -1, 1];
pub const DIR_NAMES: [&str; 6] = ["O", "W", "SO", "NW", "NO", "SW"];
const AXES: [usize; 3] = [0, 2, 4];

pub fn idx_of(q: i32, r: i32) -> usize { ((r + 4) * W as i32 + (q + 4)) as usize }
pub fn q_of(i: usize) -> i32 { (i % W) as i32 - 4 }
pub fn r_of(i: usize) -> i32 { (i / W) as i32 - 4 }
pub fn on_board(q: i32, r: i32) -> bool { q.abs() <= 4 && r.abs() <= 4 && (q + r).abs() <= 4 }
pub fn other(c: u8) -> u8 { 3 - c }
pub fn dist(i: usize) -> i32 { q_of(i).abs().max(r_of(i).abs()).max((q_of(i) + r_of(i)).abs()) }

pub struct Tables { pub cells: Vec<usize>, nb: [i8; N * 6] }

pub fn tables() -> &'static Tables {
    static T: OnceLock<Tables> = OnceLock::new();
    T.get_or_init(|| {
        let mut cells = Vec::new();
        for r in -4..=4 { for q in -4..=4 { if on_board(q, r) { cells.push(idx_of(q, r)); } } }
        let mut nb = [-1i8; N * 6];
        for &i in &cells {
            for d in 0..6 {
                let (q, r) = (q_of(i) + DQ[d], r_of(i) + DR[d]);
                if on_board(q, r) { nb[i * 6 + d] = idx_of(q, r) as i8; }
            }
        }
        Tables { cells, nb }
    })
}
pub fn cells() -> &'static [usize] { &tables().cells }
/// Nachbarfeld in Richtung d, `None` = außerhalb des Bretts.
pub fn nb(i: usize, d: usize) -> Option<usize> { let v = tables().nb[i * 6 + d]; if v < 0 { None } else { Some(v as usize) } }

#[derive(Clone, Debug, PartialEq)]
pub struct State { pub board: [u8; N], pub out: [u8; 3], pub turn: u8, pub ply: u32 }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind { Single, Inline, Side, Sumito }

#[derive(Clone, Debug)]
pub struct Move {
    pub marbles: Vec<usize>,
    pub axis: i8,
    pub dir: usize,
    pub push: Vec<usize>,
    pub off: bool,
    pub kind: Kind,
}

pub fn setup(layout: &str) -> State {
    let mut board = [0u8; N];
    let mut put = |q: i32, r: i32, c: u8| board[idx_of(q, r)] = c;
    if layout == "belgian" {
        let top = [(0, -4), (1, -4), (-1, -3), (0, -3), (1, -3), (-1, -2), (0, -2)];
        for (q, r) in top { put(q, r, BLACK); put(-q, -r, BLACK); put(-q - r, r, WHITE); put(q + r, -r, WHITE); }
    } else {
        for q in 0..=4 { put(q, -4, BLACK); put(-q, 4, WHITE); }
        for q in -1..=4 { put(q, -3, BLACK); put(-q, 3, WHITE); }
        for q in 0..=2 { put(q, -2, BLACK); put(-q, 2, WHITE); }
    }
    State { board, out: [0; 3], turn: BLACK, ply: 0 }
}

pub fn legal_moves(s: &State) -> Vec<Move> {
    let b = &s.board;
    let (me, opp) = (s.turn, other(s.turn));
    let mut moves = Vec::new();
    for &start in cells() {
        if b[start] != me { continue; }
        for m in 0..6 {
            if let Some(t) = nb(start, m) {
                if b[t] == 0 { moves.push(Move { marbles: vec![start], axis: -1, dir: m, push: vec![], off: false, kind: Kind::Single }); }
            }
        }
        for &a in &AXES {
            let mut g = vec![start];
            for _ in 2..=3 {
                let nx = match nb(*g.last().unwrap(), a) { Some(n) if b[n] == me => n, _ => break };
                g.push(nx);
                let size = g.len();
                for m in 0..6 {
                    if m == a || m == (a ^ 1) {
                        let lead = if m == a { g[size - 1] } else { g[0] };
                        let p = match nb(lead, m) { Some(p) if b[p] != me => p, _ => continue };
                        if b[p] == 0 {
                            moves.push(Move { marbles: g.clone(), axis: a as i8, dir: m, push: vec![], off: false, kind: Kind::Inline });
                            continue;
                        }
                        let mut pushed = Vec::new();
                        let mut q = Some(p);
                        while let Some(x) = q { if b[x] != opp { break; } pushed.push(x); q = nb(x, m); }
                        if pushed.len() >= size { continue; }
                        match q {
                            None => moves.push(Move { marbles: g.clone(), axis: a as i8, dir: m, push: pushed, off: true, kind: Kind::Sumito }),
                            Some(x) if b[x] == 0 => moves.push(Move { marbles: g.clone(), axis: a as i8, dir: m, push: pushed, off: false, kind: Kind::Sumito }),
                            _ => {}
                        }
                    } else if g.iter().all(|&x| matches!(nb(x, m), Some(t) if b[t] == 0)) {
                        moves.push(Move { marbles: g.clone(), axis: a as i8, dir: m, push: vec![], off: false, kind: Kind::Side });
                    }
                }
            }
        }
    }
    moves
}

pub fn apply_move(s: &State, mv: &Move) -> State {
    let mut n = s.clone();
    let all: Vec<usize> = mv.marbles.iter().chain(mv.push.iter()).copied().collect();
    let steps: Vec<(Option<usize>, u8)> = all.iter().map(|&i| (nb(i, mv.dir), s.board[i])).collect();
    for &i in &all { n.board[i] = 0; }
    for (to, c) in steps {
        match to { None => n.out[c as usize] += 1, Some(t) => n.board[t] = c }
    }
    n.turn = other(s.turn);
    n.ply = s.ply + 1;
    n
}

pub fn winner(s: &State) -> u8 {
    if s.out[WHITE as usize] >= WIN_AT { BLACK } else if s.out[BLACK as usize] >= WIN_AT { WHITE } else { 0 }
}

pub fn find_move(s: &State, marbles: &[usize], dir: usize) -> Option<Move> {
    let mut want = marbles.to_vec();
    want.sort_unstable();
    legal_moves(s).into_iter().find(|m| {
        let mut x = m.marbles.clone();
        x.sort_unstable();
        m.dir == dir && x == want
    })
}

pub fn label(i: usize) -> String { format!("{}{}", (65 + (4 - r_of(i)) as u8) as char, q_of(i) + 5) }
pub fn parse_label(t: &str) -> Option<usize> {
    let b = t.trim().as_bytes();
    if b.len() != 2 { return None; }
    let (row, col) = (b[0].to_ascii_uppercase(), b[1]);
    if !(b'A'..=b'I').contains(&row) || !(b'1'..=b'9').contains(&col) { return None; }
    let (r, q) = (4 - (row - b'A') as i32, (col - b'0') as i32 - 5);
    if on_board(q, r) { Some(idx_of(q, r)) } else { None }
}
pub fn move_text(mv: &Move) -> String {
    let m: Vec<String> = mv.marbles.iter().map(|&i| label(i)).collect();
    let suffix = match (mv.kind, mv.off) { (Kind::Sumito, true) => " (Kugel raus!)", (Kind::Sumito, false) => " (schiebt)", _ => "" };
    format!("{} {}{}", m.join(","), DIR_NAMES[mv.dir], suffix)
}

pub fn board_string(s: &State) -> String { s.board.iter().map(|&c| (b'0' + c) as char).collect() }
pub fn board_from_string(t: &str) -> Option<[u8; N]> {
    if t.len() != N { return None; }
    let mut b = [0u8; N];
    for (i, c) in t.bytes().enumerate() { if !(b'0'..=b'2').contains(&c) { return None; } b[i] = c - b'0'; }
    Some(b)
}

pub fn ascii(s: &State) -> String {
    let mut rows = Vec::new();
    for r in (-4i32..=4).rev() {
        let mut line = " ".repeat(r.unsigned_abs() as usize) + &((65 + (4 - r) as u8) as char).to_string() + " ";
        for q in -4..=4 { if on_board(q, r) { line.push(['.', 'X', 'O'][s.board[idx_of(q, r)] as usize]); line.push(' '); } }
        rows.push(line.trim_end().to_string());
    }
    rows.join("\n") // X = Schwarz, O = Weiß
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty(turn: u8) -> State { State { board: [0; N], out: [0; 3], turn, ply: 0 } }
    fn put(s: &mut State, l: &str, c: u8) { s.board[parse_label(l).unwrap()] = c; }
    fn mv(s: &State, labs: &[&str], dir: &str) -> Option<Move> {
        let m: Vec<usize> = labs.iter().map(|l| parse_label(l).unwrap()).collect();
        find_move(s, &m, DIR_NAMES.iter().position(|d| *d == dir).unwrap())
    }
    fn count(s: &State, c: u8) -> usize { s.board.iter().filter(|&&x| x == c).count() }

    #[test]
    fn start_position() {
        assert_eq!(cells().len(), 61);
        for l in ["standard", "belgian"] {
            let s = setup(l);
            assert_eq!(count(&s, 1), 14);
            assert_eq!(count(&s, 2), 14);
        }
    }
    #[test]
    fn standard_start_has_44_moves() { assert_eq!(legal_moves(&setup("standard")).len(), 44); }
    #[test]
    fn sumito_2v1_pushes() {
        let mut s = empty(1);
        put(&mut s, "E3", 1); put(&mut s, "E4", 1); put(&mut s, "E5", 2);
        let n = apply_move(&s, &mv(&s, &["E3", "E4"], "O").unwrap());
        assert_eq!(n.board[parse_label("E6").unwrap()], 2);
        assert_eq!(n.board[parse_label("E5").unwrap()], 1);
    }
    #[test]
    fn two_vs_two_blocked_three_vs_two_ok() {
        let mut s = empty(1);
        for l in ["E3", "E4"] { put(&mut s, l, 1); }
        for l in ["E5", "E6"] { put(&mut s, l, 2); }
        assert!(mv(&s, &["E3", "E4"], "O").is_none());
        put(&mut s, "E2", 1);
        assert!(mv(&s, &["E2", "E3", "E4"], "O").is_some());
    }
    #[test]
    fn own_marble_behind_blocks() {
        let mut s = empty(1);
        put(&mut s, "E3", 1); put(&mut s, "E4", 1); put(&mut s, "E5", 2); put(&mut s, "E6", 1);
        assert!(mv(&s, &["E3", "E4"], "O").is_none());
    }
    #[test]
    fn push_off_edge_and_win() {
        let mut s = empty(1);
        put(&mut s, "E7", 1); put(&mut s, "E8", 1); put(&mut s, "E9", 2);
        let m = mv(&s, &["E7", "E8"], "O").unwrap();
        assert!(m.off);
        let mut n = apply_move(&s, &m);
        assert_eq!(n.out[2], 1);
        assert_eq!(count(&n, 2), 0);
        n.out[2] = 6;
        assert_eq!(winner(&n), 1);
    }
    #[test]
    fn side_moves_need_free_cells() {
        let mut s = empty(1);
        put(&mut s, "E4", 1); put(&mut s, "E5", 1); put(&mut s, "F5", 2);
        for m in legal_moves(&s).iter().filter(|m| m.kind == Kind::Side && m.marbles.len() == 2) {
            for &i in &m.marbles { assert_eq!(s.board[nb(i, m.dir).unwrap()], 0); }
        }
    }
    #[test]
    fn labels_roundtrip() { for &i in cells() { assert_eq!(parse_label(&label(i)), Some(i)); } }
    #[test]
    fn random_games_keep_invariants() {
        let mut seed: u64 = 7;
        let mut rnd = |n: usize| { seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); ((seed >> 33) as usize) % n };
        for g in 0..20 {
            let mut s = setup(if g % 2 == 1 { "belgian" } else { "standard" });
            for _ in 0..400 {
                if winner(&s) != 0 { break; }
                let ms = legal_moves(&s);
                assert!(!ms.is_empty());
                s = apply_move(&s, &ms[rnd(ms.len())]);
                assert_eq!(count(&s, 1) + s.out[1] as usize, 14);
                assert_eq!(count(&s, 2) + s.out[2] as usize, 14);
            }
        }
    }
}
