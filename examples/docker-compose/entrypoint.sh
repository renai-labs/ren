#!/bin/sh
set -e

CERT_DIR=/certs
mkdir -p "$CERT_DIR"

# Generate CA cert on every startup
cat > /tmp/ca.cnf <<'EOF'
[req]
distinguished_name = req_dn
x509_extensions = v3_ca
prompt = no

[req_dn]
CN = iron-proxy Demo CA

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign
EOF

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$CERT_DIR/ca.key" -out "$CERT_DIR/ca.crt" \
  -days 365 -nodes -config /tmp/ca.cnf
echo "Generated CA cert at $CERT_DIR/ca.crt"

exec iron-proxy -config /etc/iron-proxy/proxy.yaml
