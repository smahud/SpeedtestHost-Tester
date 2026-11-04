#!/bin/sh
# Download the official Ookla binaries used by the laboratory and verify them.
#
#   sh lab/scripts/download-official.sh
#
# The binaries are NOT committed to the repository: they are proprietary.  The
# expected SHA-256 values live in lab/binaries/MANIFEST.md and
# lab/cli/MANIFEST.md and are checked here, so a corrupted or swapped download
# is rejected instead of being executed.
#
# Every path is derived from the script location.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BIN="$LAB_DIR/binaries"
CLI="$LAB_DIR/cli"
mkdir -p "$BIN" "$CLI"

# --- expected checksums (see lab/binaries/MANIFEST.md) ----------------------
OOKLA_X86_64_TGZ_SHA="ce180aa3ed9b3c099713cf37ea2ded48c1f799f47c534ab732e21cea61598159"
OOKLA_AARCH64_TGZ_SHA="c72b4f4380f5fed6d43a6a1460055de0d43149cba178c0ebde7ba6af12061615"
OOKLA_X86_64_BIN_SHA="f19e5ed240dc185bcaf6ca96e0fa40d5ee53e3a543f4c562082ac0d8d92f027a"
OOKLA_AARCH64_BIN_SHA="f7fd93c377ac4b7640a8b1ddba1f87254cd731e6d0d73111588a6dda9780edaa"
CLI_TGZ_SHA="5690596c54ff9bed63fa3732f818a05dbc2db19ad36ed68f21ca5f64d5cfeeb7"
CLI_BIN_SHA="31f1124c5ab8acdae6b9fe1741e704df420f9f2e7d429679fabe62075453c051"

check () {  # check <file> <expected-sha256>
  got=$(sha256sum "$1" | cut -d' ' -f1)
  if [ "$got" != "$2" ]; then
    echo "SHA-256 MISMATCH for $1" >&2
    echo "  expected: $2" >&2
    echo "  got     : $got" >&2
    exit 1
  fi
  echo "  ok  $(basename "$1")  $got"
}

fetch () {  # fetch <url> <destination>
  if [ -s "$2" ]; then
    echo "  have $(basename "$2")"
  else
    echo "  get  $(basename "$2")"
    curl -sS -L -o "$2" "$1"
  fi
}

echo "== official OoklaServer daemon =="
fetch https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz \
      "$BIN/OoklaServer-linux-x86_64-static-musl.tgz"
fetch https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz \
      "$BIN/OoklaServer-linux-aarch64-static-musl.tgz"
check "$BIN/OoklaServer-linux-x86_64-static-musl.tgz" "$OOKLA_X86_64_TGZ_SHA"
check "$BIN/OoklaServer-linux-aarch64-static-musl.tgz" "$OOKLA_AARCH64_TGZ_SHA"

mkdir -p "$BIN/x86_64" "$BIN/aarch64"
tar xzf "$BIN/OoklaServer-linux-x86_64-static-musl.tgz" -C "$BIN/x86_64"
tar xzf "$BIN/OoklaServer-linux-aarch64-static-musl.tgz" -C "$BIN/aarch64"
check "$BIN/x86_64/OoklaServer" "$OOKLA_X86_64_BIN_SHA"
check "$BIN/aarch64/OoklaServer" "$OOKLA_AARCH64_BIN_SHA"
chmod +x "$BIN/x86_64/OoklaServer" "$BIN/aarch64/OoklaServer"

echo "== official Speedtest CLI =="
fetch https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz \
      "$BIN/ookla-speedtest-1.2.0-linux-x86_64.tgz"
check "$BIN/ookla-speedtest-1.2.0-linux-x86_64.tgz" "$CLI_TGZ_SHA"
tar xzf "$BIN/ookla-speedtest-1.2.0-linux-x86_64.tgz" -C "$CLI"
check "$CLI/speedtest" "$CLI_BIN_SHA"
chmod +x "$CLI/speedtest"

echo
echo "versions:"
"$BIN/x86_64/OoklaServer" --version 2>&1 | tail -1 || true
"$CLI/speedtest" --version 2>&1 | head -1 || true
