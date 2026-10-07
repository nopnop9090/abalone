//! Minimaler HTTP/1.1-Server und -Client auf std::net (kein TLS, Connection: close).
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

pub const MAX_BODY: usize = 16 * 1024;

pub struct Request { pub method: String, pub path: String, pub query: Vec<(String, String)>, pub body: Vec<u8> }
impl Request {
    pub fn q(&self, k: &str) -> Option<&str> { self.query.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str()) }
}
pub struct Response { pub status: u16, pub ctype: &'static str, pub body: Vec<u8> }
impl Response {
    pub fn json(status: u16, body: String) -> Response { Response { status, ctype: "application/json", body: body.into_bytes() } }
    pub fn asset(ctype: &'static str, body: &'static str) -> Response { Response { status: 200, ctype, body: body.as_bytes().to_vec() } }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) { out.push(v); i += 3; continue; }
                out.push(b'%'); i += 1;
            }
            b'+' => { out.push(b' '); i += 1; }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn read_request(stream: &mut TcpStream) -> Result<Request, (u16, &'static str)> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    let head_end = loop {
        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") { break p; }
        if buf.len() > 16 * 1024 { return Err((431, "Header zu groß")); }
        let n = stream.read(&mut chunk).map_err(|_| (408, "Timeout"))?;
        if n == 0 { return Err((400, "Verbindung beendet")); }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or("").to_string(), first.next().unwrap_or("/").to_string());
    let mut len = 0usize;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") { len = v.trim().parse().map_err(|_| (400, "Content-Length"))?; }
        }
    }
    if len > MAX_BODY { return Err((413, "Body zu groß")); }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk).map_err(|_| (408, "Timeout"))?;
        if n == 0 { return Err((400, "Body unvollständig")); }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    let (path, qs) = target.split_once('?').unwrap_or((&target, ""));
    let query = qs.split('&').filter(|p| !p.is_empty()).map(|p| {
        let (k, v) = p.split_once('=').unwrap_or((p, ""));
        (percent_decode(k), percent_decode(v))
    }).collect();
    Ok(Request { method, path: percent_decode(path), query, body })
}

fn reason(code: u16) -> &'static str {
    match code { 200 => "OK", 204 => "No Content", 400 => "Bad Request", 403 => "Forbidden", 404 => "Not Found", 405 => "Method Not Allowed",
        408 => "Request Timeout", 413 => "Payload Too Large", 431 => "Request Header Fields Too Large", _ => "Error" }
}

fn write_response(stream: &mut TcpStream, r: &Response) {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
        r.status, reason(r.status), r.ctype, r.body.len());
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&r.body);
    let _ = stream.flush();
}

/// Bedient Verbindungen (ein Thread pro Verbindung) bis der Listener schließt.
pub fn serve<H>(listener: TcpListener, handler: Arc<H>) where H: Fn(Request) -> Response + Send + Sync + 'static {
    for conn in listener.incoming() {
        let Ok(mut stream) = conn else { continue };
        let h = handler.clone();
        std::thread::spawn(move || {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
            let resp = match read_request(&mut stream) {
                Ok(req) if req.method == "OPTIONS" => Response { status: 204, ctype: "text/plain", body: vec![] },
                Ok(req) => h(req),
                Err((c, m)) => Response::json(c, format!("{{\"error\":\"{}\"}}", m)),
            };
            write_response(&mut stream, &resp);
        });
    }
}

/// Einfacher HTTP-Client (nur http://). `server` = "host:port" oder "http://host:port[/]".
pub fn request(server: &str, method: &str, path: &str, body: Option<&str>) -> Result<(u16, String), String> {
    let host = server.trim_start_matches("http://").trim_end_matches('/');
    if server.starts_with("https://") { return Err("https wird nicht unterstützt (nur http://)".into()); }
    let addr = host.to_socket_addrs().map_err(|e| format!("{}: {}", host, e))?.next().ok_or("Adresse nicht auflösbar")?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(10)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(60))).ok();
    let b = body.unwrap_or("");
    let req = format!("{} {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", method, path, host, b.len(), b);
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").ok_or("ungültige Antwort")?;
    let code = head.split(' ').nth(1).and_then(|c| c.parse().ok()).ok_or("ungültiger Statuscode")?;
    Ok((code, body.to_string()))
}
