#!/bin/sh
# Legacy alias: run the v1.2.0 suite against the HTTPS-mode daemon.
exec sh "$(dirname "$0")/test-v1.2.sh" https
