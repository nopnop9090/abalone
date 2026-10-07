use abalone::{bot, server};
use std::net::TcpListener;

const USAGE: &str = "Abalone

Verwendung:
  abalone [serve] [--bind ADRESSE:PORT]      Server + Browser-UI starten (Standard 0.0.0.0:3000)
  abalone bot --server HOST:PORT [--room CODE] [--level easy|medium|hard]
              [--layout standard|belgian] [--color b|w|random]
                                             Bot (eingebaute Engine) spielt per HTTP-API;
                                             ohne --room wird ein neuer Raum angelegt
";

/// LAN-Adresse über das Routing der Standard-Schnittstelle (UDP-connect sendet keine Pakete).
fn lan_ip() -> Option<std::net::IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    s.local_addr().ok().map(|a| a.ip()).filter(|ip| !ip.is_unspecified() && !ip.is_loopback())
}

fn print_urls(addr: std::net::SocketAddr) {
    let port = addr.port();
    println!("Abalone läuft. UI im Browser öffnen:");
    if addr.ip().is_unspecified() {
        println!("  lokal:  http://localhost:{}", port);
        if let Some(ip) = lan_ip() { println!("  im LAN: http://{}:{}", ip, port); }
    } else {
        println!("  http://{}", addr);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().filter(|a| !a.starts_with('-')).cloned().unwrap_or_else(|| "serve".into());
    let rest = if args.first().map_or(false, |a| !a.starts_with('-')) { &args[1..] } else { &args[..] };
    let opt = |name: &str| rest.iter().position(|a| a == name).and_then(|i| rest.get(i + 1)).cloned();
    if rest.iter().any(|a| a == "--help" || a == "-h") || cmd == "help" { print!("{}", USAGE); return; }
    match cmd.as_str() {
        "serve" => {
            let bind = opt("--bind").or_else(|| std::env::var("PORT").ok().map(|p| format!("0.0.0.0:{}", p))).unwrap_or_else(|| "0.0.0.0:3000".into());
            let l = TcpListener::bind(&bind).unwrap_or_else(|e| { eprintln!("Bind {} fehlgeschlagen: {}", bind, e); std::process::exit(1) });
            print_urls(l.local_addr().unwrap());
            server::run(l);
        }
        "bot" => {
            let o = bot::Options {
                server: opt("--server").unwrap_or_else(|| "127.0.0.1:3000".into()), room: opt("--room").map(|r| r.to_uppercase()),
                level: opt("--level").unwrap_or_else(|| "medium".into()), layout: opt("--layout").unwrap_or_else(|| "standard".into()),
                color: opt("--color").unwrap_or_else(|| "random".into()),
            };
            if let Err(e) = bot::run(o) { eprintln!("Fehler: {}", e); std::process::exit(1); }
        }
        _ => { eprint!("{}", USAGE); std::process::exit(2); }
    }
}
