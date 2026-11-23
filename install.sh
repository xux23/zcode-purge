#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
script="$root/plugins/zcode-purge/scripts/purge.mjs"
if command -v node >/dev/null 2>&1; then
  exec node "$script" install "$@"
fi
if [ -n "${ZCODE_NODE_FALLBACK_EXEC_PATH:-}" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$ZCODE_NODE_FALLBACK_EXEC_PATH" "$script" install "$@"
fi
echo "Node.js (>=18) not found." >&2
exit 1
