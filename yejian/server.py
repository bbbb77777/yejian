#!/usr/bin/env python3
"""Tiny same-origin server for the PDF reader and the local Ollama bridge."""

from http import client
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent
OLLAMA_PROCESS = None


class ReaderHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/ollama-status":
            self._ollama_status()
            return
        super().do_GET()

    def _ollama_status(self):
        try:
            response = self._ollama_request("GET", "/api/tags")
            payload = json.loads(response.body.decode("utf-8"))
            payload["connected"] = response.status == 200
            payload["managed"] = OLLAMA_PROCESS is not None and OLLAMA_PROCESS.poll() is None
            self._json(response.status, payload)
        except Exception as error:
            self._json(503, {"connected": False, "managed": False, "error": str(error)})

    def _start_ollama(self):
        global OLLAMA_PROCESS
        if self._is_ollama_ready():
            self._json(200, {"connected": True, "started": False, "message": "Ollama 已经在运行"})
            return
        if not shutil.which("ollama"):
            self._json(503, {"connected": False, "error": "找不到 ollama 命令，请先安装 Ollama"})
            return
        if OLLAMA_PROCESS is None or OLLAMA_PROCESS.poll() is not None:
            OLLAMA_PROCESS = subprocess.Popen(
                ["ollama", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        for _ in range(20):
            if self._is_ollama_ready():
                self._json(200, {"connected": True, "started": True, "message": "Ollama 已启动"})
                return
            time.sleep(0.25)
        self._json(504, {"connected": False, "error": "Ollama 启动超时，请检查 Ollama 安装或系统权限"})

    def _is_ollama_ready(self):
        try:
            response = self._ollama_request("GET", "/api/tags")
            return response.status == 200
        except Exception:
            return False

    def do_POST(self):
        if self.path == "/api/ollama-start":
            self._start_ollama()
            return
        if self.path != "/api/chat":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            try:
                request = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                request = {}
            if request.get("stream") is True:
                self._stream_ollama(body)
                return
            # Use Ollama's native chat endpoint so the `think` option is
            # honored consistently for thinking models such as Qwen.
            response = self._ollama_request("POST", "/api/chat", body)
            self.send_response(response.status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response.body)))
            self.end_headers()
            self.wfile.write(response.body)
        except Exception as error:
            self._json(502, {"error": f"无法连接 Ollama：{error}"})

    def _stream_ollama(self, body):
        connection = client.HTTPConnection("127.0.0.1", 11434, timeout=65)
        try:
            connection.request("POST", "/api/chat", body=body, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            self.send_response(response.status)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except BrokenPipeError:
            # The browser may stop reading after a timeout or navigation.
            pass
        finally:
            connection.close()

    @staticmethod
    def _ollama_request(method, path, body=None):
        connection = client.HTTPConnection("127.0.0.1", 11434, timeout=65)
        headers = {"Content-Type": "application/json"}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return type("OllamaResponse", (), {"status": response.status, "body": data})

    def log_message(self, format, *args):
        # Keep the terminal output quiet while still showing proxy failures.
        if self.path.startswith("/api/") and args and str(args[1]).startswith("5"):
            super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PDF_STUDIO_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), ReaderHandler)
    print(f"页间已启动：http://127.0.0.1:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
