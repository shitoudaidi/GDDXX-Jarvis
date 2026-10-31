"""Jarvis: a local-first voice assistant. Run with  python -m jarvis  (see service.py)."""
import sys

__version__ = "2.0.3"

# logs carry Chinese text; a Windows console or pipe defaults to a legacy code page and would raise on it
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
