# HTTP/JSON-Protokoll

Jeder Teilnehmer – Browser, `abalone bot`, ein Python-Skript, ein LLM-Agent – spricht dasselbe Protokoll.
Alle Antworten sind JSON, CORS ist offen (`Access-Control-Allow-Origin: *`). Nur `http://` (kein TLS); für
Zugriff über das Internet Port freigeben oder einen Tunnel/Reverse-Proxy vorschalten.

**Konventionen:** Farben `1` = Schwarz (beginnt), `2` = Weiß, `0` = Zuschauer. Felder sind Indizes `0..80`
(`(r+4)*9 + (q+4)`, axiale Koordinaten; Brett-String hat 81 Zeichen `0/1/2`). Richtungen: `0 O, 1 W, 2 SO, 3 NW, 4 NO, 5 SW`.
Benennung: Reihen `A` (unten/Weiß) bis `I`, Spalten `1`–`9` (z. B. `E5` = Mitte).
Fehler: HTTP-Status ≠ 200 mit `{"error":"…"}`.

## Raum anlegen / beitreten
| Request | Body | Antwort |
|---|---|---|
| `POST /api/rooms` | `{"layout":"standard"\|"belgian","color":"b"\|"w"\|"random"}` | Sync-Objekt + `token` |
| `POST /api/rooms/{code}/join` | `{"token":"…"}` (optional, zum Wiederbeitritt) | Sync-Objekt + `token` (leer bei Zuschauer) |

Das `token` ist das Geheimnis des Sitzes – für alle weiteren Aufrufe aufbewahren.

## Zustand abfragen (Long-Poll)
`GET /api/rooms/{code}?since={version}&wait={sek ≤ 30}&token={token}`

Antwortet sofort, wenn `version > since` (oder `since` fehlt), sonst sobald sich etwas ändert bzw. nach `wait` Sekunden.
Der Aufruf gilt außerdem als Lebenszeichen („Spieler anwesend", 45 s).

Sync-Objekt:
```json
{ "room":"K7QM2", "layout":"standard", "color":1, "version":7,
  "state":{"board":"0000…","out":[0,0,1],"turn":2,"ply":6},
  "history":[{"marbles":[3,4],"dir":0,"by":1}],
  "players":{"1":true,"2":true}, "seated":{"1":true,"2":true},
  "over":null, "rematch":{"1":false,"2":false}, "chat":[],
  "legal_moves":[{"marbles":[3,4],"dir":0,"text":"E3,E4 O (schiebt)"}] }
```
- `out[c]` = Anzahl der herausgeschobenen Kugeln der Farbe `c`; 6 verlorene Kugeln beenden das Spiel.
- `over` = `{"winner":1,"reason":"captured"|"resign"|"nomoves"}`.
- `legal_moves` ist nur vorhanden, wenn der Anfragende am Zug ist – Bots/LLMs brauchen keine eigene Regel-Implementierung.

## Aktionen (`POST /api/rooms/{code}/{aktion}`, Antwort = Sync-Objekt)
| Aktion | Body |
|---|---|
| `move` | `{"token":"…","marbles":[idx,…],"dir":0-5}` – 1–3 Kugeln, Reihenfolge egal; wird serverseitig geprüft |
| `resign` | `{"token":"…"}` |
| `rematch` | `{"token":"…"}` – beide Spieler → Neustart mit getauschten Farben |
| `chat` | `{"token":"…","text":"…"}` (max. 200 Zeichen) |

## Engine
`POST /api/ai` mit `{"state":{"board","out","turn","ply"},"level":"easy|medium|hard"}` → `{"marbles":[…],"dir":n,"text":"…"}` oder `null`.

## Beispiel mit curl
```bash
curl -s -XPOST localhost:3000/api/rooms -d '{"color":"b"}'                 # -> room, token
curl -s "localhost:3000/api/rooms/CODE?since=1&wait=20&token=TOKEN"         # warten
curl -s -XPOST localhost:3000/api/rooms/CODE/move -d '{"token":"TOKEN","marbles":[22,23],"dir":0}'
```
Weitere Beispiele: `abalone bot …` (Rust, eingebaute Engine), `examples/bot.py` (Python-stdlib).
