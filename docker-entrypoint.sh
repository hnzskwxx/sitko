#!/bin/sh
# Připojený disk bývá vlastněný rootem: nastavit práva a aplikaci spustit jako neprivilegovaný uživatel "node".
set -e
mkdir -p "${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
