# Abalone

Browser-Clone des Strategiespiels Abalone – ohne Build-Schritt.

## Start
```bash
npm install
npm start            # http://localhost:3000
npm run share        # zusätzlich Cloudflare-Quick-Tunnel (benötigt `cloudflared`)
npm test             # Regel-Tests
```

## Modi
- **Computer** (Alpha-Beta-Suche, 3 Stärken, läuft im Web Worker)
- **LLM**: beliebige OpenAI-kompatible API (URL, Key, Modell im Menü). Der Aufruf geht über den lokalen Server (`/api/llm`, nur für den Host erreichbar). Das LLM bekommt Brett + nummerierte Liste legaler Züge; bei ungültiger Antwort bis zu 3 Versuche, danach spielt der Computer den Zug.
- **2 Spieler lokal** (Hot-Seat)
- **Online**: Raum erstellen → Link teilen. Mit `npm run share` wird die `trycloudflare.com`-URL automatisch in den Link eingebaut. Alternativ eigenen Tunnel (ngrok, localhost.run …) auf den Port zeigen lassen und die URL im Online-Panel eintragen. Der Server validiert jeden Zug; Reconnect nach Reload funktioniert.

## Regeln
1–3 eigene, zusammenhängende Kugeln einer Linie ziehen ein Feld (seitwärts oder in Linienrichtung). In Linienrichtung dürfen gegnerische Kugeln bei Überzahl (2v1, 3v1, 3v2) geschoben werden, wenn dahinter Platz oder der Rand ist. Wer zuerst 6 gegnerische Kugeln herausschiebt, gewinnt. Aufstellungen: Standard, Belgische Margerite.

## Struktur
`shared/rules.js` Spiellogik · `shared/ai.js` Computer · `shared/llm.js` LLM-Prompt · `server.js` HTTP/WebSocket/Proxy/Tunnel · `public/` UI
