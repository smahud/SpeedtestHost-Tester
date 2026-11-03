#!/usr/bin/env bash
# gen-certs.sh — generate the lab PKI for OoklaServer TLS testing.
# Usage: bash gen-certs.sh   (paths are lab-relative; run from anywhere)
#
# Outputs (into <lab>/certs/):
#   ca.key / ca.crt                — dedicated lab CA (private key NEVER committed)
#   ca-bundle.pem                  — trust bundle for strict-verification probes
#   server.key / server.crt        — VALID:   CN=lab.ookla.test, SAN localhost/127.0.0.1/::1
#   server-expired.crt             — EXPIRED: same SANs, notAfter in the past (CA-signed)
#   server-mismatch.crt            — MISMATCH: valid, but SAN only DNS:other.ookla.test
# <lab>/run/cert.pem + key.pem get the VALID pair (daemon's active cert).
set -euo pipefail

LAB="$(cd "$(dirname "$0")/.." && pwd)"
CERTS="$LAB/certs"
RUN="$LAB/run"
mkdir -p "$CERTS" "$RUN"
cd "$CERTS"

echo "== Lab CA =="
[ -f ca.key ] || openssl genrsa -out ca.key 2048 2>/dev/null
openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.crt \
  -subj "/C=ID/O=zai-lab/CN=zai Lab Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"
cat ca.crt > ca-bundle.pem

echo "== Server key (shared by all server certs) =="
[ -f server.key ] || openssl genrsa -out server.key 2048 2>/dev/null

mkcert() { # name subject sans extfile-extra args...
  local name="$1" subj="$2" sans="$3"; shift 3
  openssl req -new -key server.key -out "$name.csr" -subj "$subj" 2>/dev/null
  cat > "$name.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$sans
EOF
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$name.crt" -sha256 -extfile "$name.ext" "$@" 2>/dev/null
  rm -f "$name.csr"
}

echo "== VALID server cert (lab.ookla.test / localhost / loopback) =="
mkcert server "/C=ID/O=zai-lab/CN=lab.ookla.test" \
  "DNS:lab.ookla.test,DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1" -days 825

echo "== EXPIRED server cert (notBefore 2020, notAfter 2021 — genuinely in the past) =="
mkcert server-expired "/C=ID/O=zai-lab/CN=lab.ookla.test" \
  "DNS:lab.ookla.test,DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1" \
  -not_before 20200101000000Z -not_after 20210101000000Z

echo "== HOSTNAME-MISMATCH server cert (SAN only DNS:other.ookla.test) =="
mkcert server-mismatch "/C=ID/O=zai-lab/CN=other.ookla.test" \
  "DNS:other.ookla.test" -days 825

echo "== Activate the VALID pair in the daemon run dir =="
cp -f server.crt "$RUN/cert.pem"
cp -f server.key "$RUN/key.pem"

echo
echo "== Summary =="
for f in ca.crt server.crt server-expired.crt server-mismatch.crt; do
  printf '%-20s %s\n' "$f" "$(openssl x509 -in "$f" -noout -subject -enddate | tr '\n' ' ')"
done
sha256sum ca.crt server.crt server-expired.crt server-mismatch.crt
echo
echo "Private keys stay in $CERTS (gitignored). ca-bundle.pem = strict-verification trust bundle."
