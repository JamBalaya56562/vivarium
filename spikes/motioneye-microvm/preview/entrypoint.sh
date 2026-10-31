#!/usr/bin/env sh
set -e
python3 /usr/local/lib/preview/fakecam.py &
python3 /usr/local/lib/preview/hooks.py &
exec /usr/local/bin/meyectl startserver -c /etc/motioneye/motioneye.conf
