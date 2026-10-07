use abalone::http::request;
use abalone::json::{self, Value};
use abalone::server;
use std::net::TcpListener;
use std::time::{Duration, Instant};

fn start() -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap().to_string();
    std::thread::spawn(move || server::run(l));
    addr
}
fn call(addr: &str, m: &str, p: &str, body: Option<&str>) -> (u16, Value) {
    let (c, t) = request(addr, m, p, body).unwrap();
    (c, json::parse(&t).unwrap_or(Value::Null))
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str { v.get(k).unwrap().as_str().unwrap() }
fn n(v: &Value, k: &str) -> f64 { v.get(k).unwrap().as_f64().unwrap() }

#[test]
fn two_players_play_and_longpoll_wakes() {
    let a = start();
    let (c, r) = call(&a, "POST", "/api/rooms", Some(r#"{"color":"b"}"#));
    assert_eq!(c, 200);
    let (room, t1) = (s(&r, "room").to_string(), s(&r, "token").to_string());
    assert_eq!(n(&r, "color"), 1.0);
    // Gegner fehlt
    let (c, e) = call(&a, "POST", &format!("/api/rooms/{}/move", room), Some(&format!(r#"{{"token":"{}","marbles":[10],"dir":0}}"#, t1)));
    assert_eq!(c, 400);
    assert!(s(&e, "error").contains("Gegner"));
    let (_, j) = call(&a, "POST", &format!("/api/rooms/{}/join", room), Some("{}"));
    let (t2, v0) = (s(&j, "token").to_string(), n(&j, "version"));
    assert_eq!(n(&j, "color"), 2.0);
    // Schwarz hat 44 legale Züge im Sync
    let (_, v) = call(&a, "GET", &format!("/api/rooms/{}?token={}", room, t1), None);
    let lm = v.get("legal_moves").unwrap().as_arr().unwrap();
    assert_eq!(lm.len(), 44);
    // Weiß wartet per Long-Poll auf den Zug von Schwarz
    let (a2, room2, t2b) = (a.clone(), room.clone(), t2.clone());
    let started = Instant::now();
    let h = std::thread::spawn(move || call(&a2, "GET", &format!("/api/rooms/{}?since={}&wait=10&token={}", room2, v0, t2b), None));
    std::thread::sleep(Duration::from_millis(300));
    let mv = &lm[0];
    let body = format!(r#"{{"token":"{}","marbles":{},"dir":{}}}"#, t1, json::to_string(mv.get("marbles").unwrap()), n(mv, "dir"));
    let (c, _) = call(&a, "POST", &format!("/api/rooms/{}/move", room), Some(&body));
    assert_eq!(c, 200);
    let (_, w) = h.join().unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(n(w.get("state").unwrap(), "turn"), 2.0);
    assert_eq!(w.get("history").unwrap().as_arr().unwrap().len(), 1);
    // Schwarz darf nicht erneut ziehen; Fremde ohne Token auch nicht
    let (c, _) = call(&a, "POST", &format!("/api/rooms/{}/move", room), Some(&body));
    assert_eq!(c, 400);
    let (c, _) = call(&a, "POST", &format!("/api/rooms/{}/move", room), Some(r#"{"token":"x","marbles":[1],"dir":0}"#));
    assert_eq!(c, 403);
    // Aufgabe beendet das Spiel
    let (_, r) = call(&a, "POST", &format!("/api/rooms/{}/resign", room), Some(&format!(r#"{{"token":"{}"}}"#, t2)));
    assert_eq!(n(r.get("over").unwrap(), "winner"), 1.0);
}

#[test]
fn ai_endpoint_and_errors() {
    let a = start();
    let st = r#"{"state":{"board":"000000000000000000000000000000000000000000000000000000000000000000000000000000000","out":[0,0,0],"turn":1,"ply":0},"level":"easy"}"#;
    let (c, v) = call(&a, "POST", "/api/ai", Some(st));
    assert_eq!(c, 200);
    assert!(v == Value::Null); // leeres Brett: kein Zug
    let (c, _) = call(&a, "POST", "/api/ai", Some(r#"{"state":{"board":"12"}}"#));
    assert_eq!(c, 400);
    assert_eq!(call(&a, "GET", "/api/rooms/NOPE0", None).0, 404);
    let (c, _) = request(&a, "GET", "/", None).map(|(c, b)| (c, b.contains("ABALONE"))).unwrap();
    assert_eq!(c, 200);
}

#[test]
fn bot_plays_against_bot_to_completion_or_limit() {
    let a = start();
    let (_, r) = call(&a, "POST", "/api/rooms", Some(r#"{"color":"b"}"#));
    let room = s(&r, "room").to_string();
    let (a1, r1) = (a.clone(), room.clone());
    let h = std::thread::spawn(move || {
        // Zweiter Spieler als Bot: tritt bei und zieht, bis der Test ihn mit Aufgabe beendet
        let _ = abalone::bot::run(abalone::bot::Options { server: a1, room: Some(r1), level: "easy".into(), layout: "standard".into(), color: "r".into() });
    });
    // Erster Spieler (Token aus create) wartet auf Weiß-Zug nach eigenem Zug
    let t1 = s(&r, "token").to_string();
    std::thread::sleep(Duration::from_millis(500));
    let (_, v) = call(&a, "GET", &format!("/api/rooms/{}?token={}", room, t1), None);
    let m = &v.get("legal_moves").unwrap().as_arr().unwrap()[0];
    let body = format!(r#"{{"token":"{}","marbles":{},"dir":{}}}"#, t1, json::to_string(m.get("marbles").unwrap()), n(m, "dir"));
    assert_eq!(call(&a, "POST", &format!("/api/rooms/{}/move", room), Some(&body)).0, 200);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let (_, v) = call(&a, "GET", &format!("/api/rooms/{}?token={}", room, t1), None);
        if v.get("history").unwrap().as_arr().unwrap().len() >= 2 { break; }
        assert!(Instant::now() < deadline, "Bot hat nicht gezogen");
        std::thread::sleep(Duration::from_millis(100));
    }
    call(&a, "POST", &format!("/api/rooms/{}/resign", room), Some(&format!(r#"{{"token":"{}"}}"#, t1)));
    h.join().unwrap();
}
