//! Bot-Client: spielt per HTTP-API mit der eingebauten Engine in einem Raum.
use crate::ai;
use crate::http::request;
use crate::json::{self, Value};
use crate::rules as R;

fn call(server: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let b = body.map(|b| json::to_string(&b));
    let (code, text) = request(server, method, path, b.as_deref())?;
    let v = json::parse(&text).map_err(|e| format!("Antwort ungültig: {}", e))?;
    if code != 200 { return Err(format!("HTTP {}: {}", code, v.get("error").and_then(|e| e.as_str()).unwrap_or(&text))); }
    Ok(v)
}

pub struct Options { pub server: String, pub room: Option<String>, pub level: String, pub layout: String, pub color: String }

pub fn run(o: Options) -> Result<(), String> {
    let first = match &o.room {
        Some(r) => call(&o.server, "POST", &format!("/api/rooms/{}/join", r), Some(Value::obj(vec![])))?,
        None => call(&o.server, "POST", "/api/rooms", Some(Value::obj(vec![("layout", Value::str(o.layout.clone())), ("color", Value::str(o.color.clone()))])))?,
    };
    let room = first.get("room").and_then(|r| r.as_str()).ok_or("Raum fehlt in Antwort")?.to_string();
    let token = first.get("token").and_then(|t| t.as_str()).ok_or("Kein freier Platz im Raum")?.to_string();
    let color = first.get("color").and_then(|c| c.as_f64()).unwrap_or(0.0) as u8;
    println!("Bot spielt in Raum {} als {}", room, if color == 1 { "Schwarz" } else { "Weiß" });
    let mut view = first;
    loop {
        let version = view.get("version").and_then(|v| v.as_f64()).unwrap_or(0.0) as u64;
        if let Some(over) = view.get("over").filter(|o| **o != Value::Null) {
            let w = over.get("winner").and_then(|w| w.as_f64()).unwrap_or(0.0) as u8;
            println!("Spiel beendet: {} gewinnt.", if w == 1 { "Schwarz" } else { "Weiß" });
            return Ok(());
        }
        let turn = view.get("state").and_then(|s| s.get("turn")).and_then(|t| t.as_f64()).unwrap_or(0.0) as u8;
        let both = view.get("seated").map_or(false, |s| s.get("1") == Some(&Value::Bool(true)) && s.get("2") == Some(&Value::Bool(true)));
        if turn == color && both {
            let st = view.get("state").ok_or("state fehlt")?;
            let board = R::board_from_string(st.get("board").and_then(|b| b.as_str()).unwrap_or("")).ok_or("Brett ungültig")?;
            let out = |i: usize| st.get("out").and_then(|o| o.as_arr()).and_then(|a| a.get(i)).and_then(|x| x.as_f64()).unwrap_or(0.0) as u8;
            let s = R::State { board, out: [out(0), out(1), out(2)], turn, ply: st.get("ply").and_then(|p| p.as_f64()).unwrap_or(0.0) as u32 };
            let Some(m) = ai::best_move(&s, &o.level) else { return Err("keine legalen Züge".into()) };
            println!("Zug: {}", R::move_text(&m));
            let body = Value::obj(vec![("token", Value::str(token.clone())), ("marbles", Value::Arr(m.marbles.iter().map(|&i| Value::num(i as f64)).collect())), ("dir", Value::num(m.dir as f64))]);
            view = call(&o.server, "POST", &format!("/api/rooms/{}/move", room), Some(body))?;
            continue;
        }
        view = call(&o.server, "GET", &format!("/api/rooms/{}?since={}&wait=20&token={}", room, version, token), None)?;
    }
}
