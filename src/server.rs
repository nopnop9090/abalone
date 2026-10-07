//! Räume, HTTP/JSON-API und eingebettete Browser-UI.
use crate::ai;
use crate::http::{self, Request, Response};
use crate::json::{self, Value};
use crate::rules::{self as R, State};
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::net::TcpListener;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const INDEX: &str = include_str!("../web/index.html");
const STYLE: &str = include_str!("../web/style.css");
const BOARD_JS: &str = include_str!("../web/board.js");
const APP_JS: &str = include_str!("../web/app.js");
const RULES_JS: &str = include_str!("../web/rules.js");

const PRESENT_SECS: u64 = 45;
const MAX_WAIT_SECS: u64 = 30;
const ROOM_TTL: Duration = Duration::from_secs(3600);
const CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

struct Seat { token: String, last_seen: Instant }
struct Room {
    code: String,
    layout: String,
    seats: [Option<Seat>; 2],
    state: State,
    history: Vec<(Vec<usize>, usize, u8)>,
    over: Option<(u8, &'static str)>,
    rematch: [bool; 2],
    chat: Vec<(u8, String)>,
    version: u64,
    touched: Instant,
}
#[derive(Default)]
struct Rooms { map: HashMap<String, Room> }
pub struct App { rooms: Mutex<Rooms>, cv: Condvar }

/// Zufallswerte aus dem vom Betriebssystem gesetzten Seed von RandomState (std-only).
fn rand_u64() -> u64 {
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish()
}
fn new_token() -> String { format!("{:016x}{:016x}", rand_u64(), rand_u64()) }
fn new_code(rooms: &Rooms) -> String {
    loop {
        let c: String = (0..5).map(|_| CODE_CHARS[(rand_u64() % CODE_CHARS.len() as u64) as usize] as char).collect();
        if !rooms.map.contains_key(&c) { return c; }
    }
}

fn err(code: u16, msg: &str) -> Response { Response::json(code, json::to_string(&Value::obj(vec![("error", Value::str(msg))]))) }
fn ok(v: Value) -> Response { Response::json(200, json::to_string(&v)) }

fn state_json(s: &State) -> Value {
    Value::obj(vec![("board", Value::str(R::board_string(s))), ("out", Value::Arr(s.out.iter().map(|&x| Value::num(x)).collect())),
        ("turn", Value::num(s.turn)), ("ply", Value::num(s.ply))])
}
fn parse_state(v: &Value) -> Option<State> {
    let board = R::board_from_string(v.get("board")?.as_str()?)?;
    let out = v.get("out")?.as_arr()?;
    let o = |i: usize| out.get(i).and_then(|x| x.as_f64()).map(|x| x.clamp(0.0, 14.0) as u8);
    let turn = v.get("turn")?.as_f64()? as u8;
    if turn != 1 && turn != 2 { return None; }
    Some(State { board, out: [o(0)?, o(1)?, o(2)?], turn, ply: v.get("ply")?.as_f64()?.max(0.0) as u32 })
}
fn ints(v: &Value) -> Vec<Value> { v.as_arr().map(|a| a.to_vec()).unwrap_or_default() }
fn move_json(m: &R::Move) -> Value {
    Value::obj(vec![("marbles", Value::Arr(m.marbles.iter().map(|&i| Value::num(i as f64)).collect())), ("dir", Value::num(m.dir as f64)), ("text", Value::str(R::move_text(m)))])
}

impl Room {
    fn color_of(&self, token: &str) -> u8 {
        if token.is_empty() { return 0; }
        for c in 1..=2u8 { if let Some(s) = &self.seats[c as usize - 1] { if s.token == token { return c; } } }
        0
    }
    fn bump(&mut self) { self.version += 1; self.touched = Instant::now(); }
    fn present(&self, c: u8) -> bool {
        self.seats[c as usize - 1].as_ref().map_or(false, |s| s.last_seen.elapsed().as_secs() < PRESENT_SECS)
    }
    fn view(&self, color: u8) -> Value {
        let hist = self.history.iter().map(|(m, d, by)| Value::obj(vec![
            ("marbles", Value::Arr(m.iter().map(|&i| Value::num(i as f64)).collect())), ("dir", Value::num(*d as f64)), ("by", Value::num(*by))])).collect();
        let over = match self.over { Some((w, why)) => Value::obj(vec![("winner", Value::num(w)), ("reason", Value::str(why))]), None => Value::Null };
        let mut o = vec![
            ("room", Value::str(self.code.clone())), ("layout", Value::str(self.layout.clone())), ("color", Value::num(color)),
            ("version", Value::num(self.version as f64)), ("state", state_json(&self.state)), ("history", Value::Arr(hist)),
            ("players", Value::obj(vec![("1", Value::Bool(self.present(1))), ("2", Value::Bool(self.present(2)))])),
            ("seated", Value::obj(vec![("1", Value::Bool(self.seats[0].is_some())), ("2", Value::Bool(self.seats[1].is_some()))])),
            ("over", over),
            ("rematch", Value::obj(vec![("1", Value::Bool(self.rematch[0])), ("2", Value::Bool(self.rematch[1]))])),
            ("chat", Value::Arr(self.chat.iter().map(|(by, t)| Value::obj(vec![("by", Value::num(*by)), ("text", Value::str(t.clone()))])).collect())),
        ];
        if color != 0 && color == self.state.turn && self.over.is_none() {
            o.push(("legal_moves", Value::Arr(R::legal_moves(&self.state).iter().map(move_json).collect())));
        }
        Value::obj(o)
    }
}

impl App {
    pub fn new() -> Arc<App> { Arc::new(App { rooms: Mutex::new(Rooms::default()), cv: Condvar::new() }) }

    pub fn handle(&self, req: Request) -> Response {
        let parts: Vec<&str> = req.path.trim_matches('/').split('/').collect();
        let body = || -> Result<Value, Response> {
            if req.body.is_empty() { return Ok(Value::Obj(vec![])); }
            json::parse(&String::from_utf8_lossy(&req.body)).map_err(|e| err(400, &format!("JSON: {}", e)))
        };
        match (req.method.as_str(), parts.as_slice()) {
            ("GET", [""]) | ("GET", ["index.html"]) => Response::asset("text/html", INDEX),
            ("GET", ["style.css"]) => Response::asset("text/css", STYLE),
            ("GET", ["board.js"]) => Response::asset("text/javascript", BOARD_JS),
            ("GET", ["app.js"]) => Response::asset("text/javascript", APP_JS),
            ("GET", ["rules.js"]) => Response::asset("text/javascript", RULES_JS),
            ("GET", ["api", "info"]) => ok(Value::obj(vec![("name", Value::str("abalone")), ("version", Value::str(env!("CARGO_PKG_VERSION")))])),
            ("POST", ["api", "ai"]) => match body().and_then(|b| self.ai(&b)) { Ok(r) | Err(r) => r },
            ("POST", ["api", "rooms"]) => match body() { Ok(b) => self.create(&b), Err(r) => r },
            ("GET", ["api", "rooms", code]) => self.poll(code, &req),
            ("POST", ["api", "rooms", code, action]) => match body() { Ok(b) => self.action(code, action, &b), Err(r) => r },
            ("GET", _) | ("POST", _) => err(404, "Nicht gefunden"),
            _ => err(405, "Methode nicht erlaubt"),
        }
    }

    fn ai(&self, b: &Value) -> Result<Response, Response> {
        let s = b.get("state").and_then(parse_state).ok_or_else(|| err(400, "Ungültiger Zustand"))?;
        let level = b.get("level").and_then(|l| l.as_str()).unwrap_or("medium");
        Ok(match ai::best_move(&s, level) {
            Some(m) => ok(move_json(&m)),
            None => ok(Value::Null),
        })
    }

    fn create(&self, b: &Value) -> Response {
        let mut g = self.rooms.lock().unwrap();
        let code = new_code(&g);
        let color = match b.get("color").and_then(|c| c.as_str()) { Some("b") | Some("black") => 1, Some("w") | Some("white") => 2, _ => (rand_u64() % 2) as u8 + 1 };
        let layout = if b.get("layout").and_then(|l| l.as_str()) == Some("belgian") { "belgian" } else { "standard" };
        let token = new_token();
        let mut room = Room { code: code.clone(), layout: layout.into(), seats: [None, None], state: R::setup(layout), history: vec![], over: None,
            rematch: [false; 2], chat: vec![], version: 1, touched: Instant::now() };
        room.seats[color as usize - 1] = Some(Seat { token: token.clone(), last_seen: Instant::now() });
        let mut v = room.view(color);
        if let Value::Obj(o) = &mut v { o.push(("token".into(), Value::str(token))); }
        g.map.insert(code, room);
        ok(v)
    }

    fn poll(&self, code: &str, req: &Request) -> Response {
        let code = code.to_uppercase();
        let token = req.q("token").unwrap_or("");
        let since = req.q("since").and_then(|s| s.parse::<u64>().ok());
        let wait = req.q("wait").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0).min(MAX_WAIT_SECS);
        let deadline = Instant::now() + Duration::from_secs(wait);
        let mut g = self.rooms.lock().unwrap();
        loop {
            let Some(room) = g.map.get_mut(&code) else { return err(404, "Raum nicht gefunden") };
            let color = room.color_of(token);
            if color != 0 { room.seats[color as usize - 1].as_mut().unwrap().last_seen = Instant::now(); }
            room.touched = Instant::now();
            let now = Instant::now();
            if since.map_or(true, |s| room.version > s) || now >= deadline { return ok(room.view(color)); }
            g = self.cv.wait_timeout(g, deadline - now).unwrap().0;
        }
    }

    fn action(&self, code: &str, action: &str, b: &Value) -> Response {
        let code = code.to_uppercase();
        let mut g = self.rooms.lock().unwrap();
        let Some(room) = g.map.get_mut(&code) else { return err(404, "Raum nicht gefunden") };
        let token = b.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string();
        let color = room.color_of(&token);
        let reply = match action {
            "join" => {
                let (mut c, mut tok) = (color, token.clone());
                if c == 0 {
                    if let Some(free) = (1..=2u8).find(|&c| room.seats[c as usize - 1].is_none()) { c = free; tok = new_token(); }
                }
                if c != 0 { room.seats[c as usize - 1] = Some(Seat { token: tok.clone(), last_seen: Instant::now() }); }
                room.bump();
                let mut v = room.view(c);
                if c != 0 { if let Value::Obj(o) = &mut v { o.push(("token".into(), Value::str(tok))); } }
                Ok(v)
            }
            "move" => (|| {
                if color == 0 { return Err((403, "Kein Spieler dieses Raums (Token fehlt/ungültig)")); }
                if room.over.is_some() { return Err((400, "Spiel beendet")); }
                if color != room.state.turn { return Err((400, "Nicht am Zug")); }
                if room.seats.iter().any(|s| s.is_none()) { return Err((400, "Gegner fehlt")); }
                let marbles: Vec<usize> = ints(b.get("marbles").unwrap_or(&Value::Null)).iter()
                    .filter_map(|v| v.as_f64()).filter(|&x| x >= 0.0 && x < R::N as f64 && x.fract() == 0.0).map(|x| x as usize).collect();
                let dir = b.get("dir").and_then(|d| d.as_f64()).filter(|&d| (0.0..6.0).contains(&d) && d.fract() == 0.0).ok_or((400, "Ungültige Richtung"))? as usize;
                if marbles.is_empty() || marbles.len() > 3 { return Err((400, "Ungültiger Zug")); }
                let mv = R::find_move(&room.state, &marbles, dir).ok_or((400, "Ungültiger Zug"))?;
                room.state = R::apply_move(&room.state, &mv);
                room.history.push((mv.marbles.clone(), mv.dir, color));
                let w = R::winner(&room.state);
                if w != 0 { room.over = Some((w, "captured")); }
                else if R::legal_moves(&room.state).is_empty() { room.over = Some((color, "nomoves")); }
                room.rematch = [false; 2];
                room.bump();
                Ok(room.view(color))
            })(),
            "resign" => {
                if color == 0 || room.over.is_some() { Err((400, "Aufgabe nicht möglich")) } else {
                    room.over = Some((R::other(color), "resign")); room.bump(); Ok(room.view(color))
                }
            }
            "rematch" => {
                if color == 0 || room.over.is_none() { Err((400, "Revanche nicht möglich")) } else {
                    room.rematch[color as usize - 1] = true;
                    if room.rematch == [true, true] {
                        room.state = R::setup(&room.layout); room.history.clear(); room.over = None; room.rematch = [false; 2];
                        room.seats.swap(0, 1); // Farben tauschen
                    }
                    room.bump();
                    let c = room.color_of(&token);
                    Ok(room.view(c))
                }
            }
            "chat" => {
                if color == 0 { Err((403, "Nur Spieler")) } else {
                    let t: String = b.get("text").and_then(|t| t.as_str()).unwrap_or("").chars().take(200).collect();
                    room.chat.push((color, t));
                    if room.chat.len() > 50 { room.chat.remove(0); }
                    room.bump(); Ok(room.view(color))
                }
            }
            _ => Err((404, "Unbekannte Aktion")),
        };
        self.cv.notify_all();
        match reply { Ok(v) => ok(v), Err((c, m)) => err(c, m) }
    }

    fn cleanup(&self) {
        let mut g = self.rooms.lock().unwrap();
        g.map.retain(|_, r| r.touched.elapsed() < ROOM_TTL);
    }
}

/// Startet den Server auf dem übergebenen Listener (blockiert).
pub fn run(listener: TcpListener) {
    let app = App::new();
    let a2 = app.clone();
    std::thread::spawn(move || loop { std::thread::sleep(Duration::from_secs(60)); a2.cleanup(); });
    http::serve(listener, Arc::new(move |req| app.handle(req)));
}
