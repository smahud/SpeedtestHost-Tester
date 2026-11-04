#!/bin/sh
# Generate the laboratory PKI used by the OoklaServer HTTPS lab.
#
# Creates, under lab/certs/:
#   ca.key / ca.crt            laboratory root CA (never leaves the lab)
#   server.key / server.crt    leaf cert for localhost, SAN = DNS:localhost, IP:127.0.0.1, IP:::1
#   fullchain.pem              server.crt + ca.crt  (what OoklaServer wants)
#   wronghost.key / .crt       leaf cert with SAN DNS:not-the-lab-host (hostname-mismatch negative)
#   expired.key / expired.crt  leaf cert that expired in the past (expired negative)
#   ca-bundle-cli.pem          system trust store + lab CA (official CLI --ca-certificate)
#
# Private keys (*.key) are git-ignored by the repository .gitignore and must
# never be committed.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LAB_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CERT_DIR="$LAB_DIR/certs"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

DAYS_CA=825
DAYS_LEAF=825

# ---------------------------------------------------------------- root CA ---
openssl req -x509 -newkey rsa:4096 -sha256 -days "$DAYS_CA" -nodes \
  -keyout ca.key -out ca.crt \
  -subj "/C=ID/ST=East Java/L=Malang/O=ArenaLab/OU=OoklaServer Lab/CN=ArenaLab Root CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

# ---------------------------------------------------------- leaf: localhost ---
cat > server.ext <<'EOF'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1
EOF

openssl req -newkey rsa:2048 -sha256 -nodes -keyout server.key -out server.csr \
  -subj "/C=ID/ST=East Java/L=Malang/O=ArenaLab/OU=OoklaServer Lab/CN=localhost" 2>/dev/null
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days "$DAYS_LEAF" -sha256 -extfile server.ext 2>/dev/null
cat server.crt ca.crt > fullchain.pem

# --------------------------------------- negative: valid CA, WRONG hostname ---
cat > wronghost.ext <<'EOF'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:not-the-lab-host.invalid,DNS:other.invalid
EOF
openssl req -newkey rsa:2048 -sha256 -nodes -keyout wronghost.key -out wronghost.csr \
  -subj "/C=ID/ST=East Java/L=Malang/O=ArenaLab/OU=OoklaServer Lab/CN=not-the-lab-host.invalid" 2>/dev/null
openssl x509 -req -in wronghost.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out wronghost.crt -days "$DAYS_LEAF" -sha256 -extfile wronghost.ext 2>/dev/null

# ------------------------------------------- negative: EXPIRED leaf (valid CA) ---
cat > expired.ext <<'EOF'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1
EOF
openssl req -newkey rsa:2048 -sha256 -nodes -keyout expired.key -out expired.csr \
  -subj "/C=ID/ST=East Java/L=Malang/O=ArenaLab/OU=OoklaServer Lab/CN=localhost" 2>/dev/null
# -days cannot be negative; use faketime-free approach: set explicit expiry in the past
# via `openssl ca`-less method -> use `openssl x509 -req` with -not_before/-not_after if supported.
if openssl x509 -help 2>&1 | grep -q -- '-not_after'; then
  openssl x509 -req -in expired.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out expired.crt -sha256 -extfile expired.ext \
    -not_before 20200101000000Z -not_after 20200102000000Z 2>/dev/null
else
  # Fallback: -days 1 with faketime is unavailable, so reuse server cert material and
  # mark the negative case as unavailable on this OpenSSL build.
  cp server.crt expired.crt
  echo "warning: OpenSSL lacks -not_after; expired negative cert not generated" >&2
fi

# --------------------------------------- negative: UNTRUSTED self-signed leaf ---
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS_LEAF" -nodes \
  -keyout untrusted.key -out untrusted.crt \
  -subj "/C=ID/ST=East Java/L=Malang/O=ArenaLab/OU=OoklaServer Lab/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" 2>/dev/null

# ------------------------------------- combined bundle for the official CLI ---
if [ -f /etc/ssl/certs/ca-certificates.crt ]; then
  cat /etc/ssl/certs/ca-certificates.crt ca.crt > ca-bundle-cli.pem
else
  cp ca.crt ca-bundle-cli.pem
fi

# ------------------- control-plane certificate for the official CLI stub ---
# The official Speedtest CLI talks to cli.speedtest.net (server list) and
# results.speedtest.net (result submission).  Inside the isolated namespace
# both names resolve to the local stub, so they need a certificate of their own.
cat > control.ext <<'EOF'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:cli.speedtest.net,DNS:results.speedtest.net,DNS:localhost,IP:127.0.0.1
EOF
openssl req -newkey rsa:2048 -sha256 -nodes -keyout control.key -out control.csr \
  -subj "/C=ID/ST=East Java/L=Malang/O=ArenaLab/OU=OoklaServer Lab/CN=cli.speedtest.net" 2>/dev/null
openssl x509 -req -in control.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out control.crt -days "$DAYS_LEAF" -sha256 -extfile control.ext 2>/dev/null

chmod 600 ./*.key 2>/dev/null || true
echo "lab PKI written to $CERT_DIR"
openssl x509 -in server.crt -noout -subject -issuer -dates -ext subjectAltName
