# Abalone – Stand-alone (Rust)

Abalone als **einzelne Executable** ohne externe Abhängigkeiten (nur Rust-`std`): HTTP-Server, Regeln, Computer-Gegner und die Browser-UI (eingebettet) in einem Binary.

> Der frühere Node.js-Stand liegt im Branch [`node`](../../tree/node).

## Bauen & starten
```bash
cargo build --release
./target/release/abalone                 # http://localhost:3000  (--bind 127.0.0.1:8080 | PORT=…)
./target/release/abalone bot --server HOST:3000 --room CODE --level hard   # Bot tritt einem Raum bei
./target/release/abalone bot --server HOST:3000                            # Bot legt einen neuen Raum an
cargo test
```

## Downloads
CI baut bei jedem Push Release-Binaries für Linux (x86_64), macOS (arm64, x86_64) und Windows (x86_64) als Workflow-Artefakte; bei Tags `v*` werden sie zusätzlich an ein GitHub-Release gehängt.

## Modi (Browser)
Computer (3 Stärken, Engine im Server) · 2 Spieler lokal · Online-Raum (Link teilen, Reconnect per Token).
LLM-Gegner und Cloudflare-Tunnel der Node-Version entfallen: ein LLM ist einfach ein weiterer HTTP-Client (siehe Protokoll, `legal_moves` liegt fertig im Zustand). Für Mitspieler außerhalb des LAN den Port freigeben oder einen eigenen Tunnel davor setzen.

## Externer Gegner
Browser und Executables nutzen dasselbe HTTP/JSON-Interface (Long-Poll, kein WebSocket): [docs/PROTOCOL.md](docs/PROTOCOL.md). Beispiele: `abalone bot`, `examples/bot.py`.

## Regeln
1–3 eigene, zusammenhängende Kugeln einer Linie ziehen ein Feld (seitwärts oder in Linienrichtung). In Linienrichtung dürfen gegnerische Kugeln bei Überzahl (2v1, 3v1, 3v2) geschoben werden, wenn dahinter Platz oder der Rand ist. Wer zuerst 6 gegnerische Kugeln herausschiebt, gewinnt. Aufstellungen: Standard, Belgische Margerite.

## Struktur
`src/rules.rs` Regeln · `src/ai.rs` Engine · `src/server.rs` Räume & API · `src/http.rs` HTTP · `src/json.rs` JSON · `src/bot.rs` Bot-Client · `web/` Browser-UI · `tests/api.rs` Integrationstests
