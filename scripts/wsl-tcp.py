"""Byte transport over WSL stdio, restricted to this local project's service ports."""
import socket
import sys
import threading

port = int(sys.argv[1])
if port not in (54321, 54322, 54323, 54324):
    raise ValueError('Unsupported project port')
sock = socket.create_connection(('127.0.0.1', port), timeout=10)
sock.settimeout(None)


def incoming():
    try:
        while data := sys.stdin.buffer.read1(65536):
            sock.sendall(data)
    finally:
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass


threading.Thread(target=incoming, daemon=True).start()
try:
    while data := sock.recv(65536):
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
finally:
    sock.close()
