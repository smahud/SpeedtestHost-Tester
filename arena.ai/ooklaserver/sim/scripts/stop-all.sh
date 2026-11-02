#!/bin/sh
# OoklaServer -d sometimes ignores SIGTERM; kill fallback included.
pkill -TERM -f '/home/user/ooklaserver/x86_64/OoklaServer -d' 2>/dev/null || true
sleep 1
pkill -KILL -f '/home/user/ooklaserver/x86_64/OoklaServer -d' 2>/dev/null || true
pkill -TERM -f 'legacy_fallback.py' 2>/dev/null || true
