#!/usr/bin/env python3
"""Serve the local Explorer and ping it once a minute while it is running."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from urllib.request import urlopen
import sys

ROOT = Path(__file__).resolve().parents[1]
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8768
HOST = "127.0.0.1"
URL = f"http://{HOST}:{PORT}/"
stop = Event()


def ping() -> None:
    while not stop.wait(60):
        try:
            with urlopen(URL, timeout=5) as response:
                print(f"Preview ping: {response.status} {URL}", flush=True)
        except OSError as error:
            print(f"Preview ping failed: {error}", flush=True)


handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
server = ThreadingHTTPServer((HOST, PORT), handler)
Thread(target=ping, daemon=True).start()
print(f"Preview: {URL}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    stop.set()
    server.server_close()
