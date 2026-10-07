#!/usr/bin/env python3
"""Minimaler externer Gegner (nur Python-Standardbibliothek): spielt jeweils den ersten legalen Zug.
Verwendung: python3 examples/bot.py HOST:PORT RAUMCODE"""
import json, sys, urllib.request

server, room = sys.argv[1], sys.argv[2].upper()
base = f"http://{server}/api/rooms/{room}"

def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

view = call("POST", base + "/join", {})
token = view.get("token") or sys.exit("Kein freier Platz im Raum")
print("Farbe:", view["color"])
while True:
    if view["over"]:
        print("Ende:", view["over"]); break
    if "legal_moves" in view and all(view["seated"].values()):
        m = view["legal_moves"][0]          # hier eigene Strategie einsetzen (LLM, Suche, …)
        print("Zug:", m["text"])
        view = call("POST", base + "/move", {"token": token, "marbles": m["marbles"], "dir": m["dir"]})
    else:
        view = call("GET", f"{base}?since={view['version']}&wait=20&token={token}")
