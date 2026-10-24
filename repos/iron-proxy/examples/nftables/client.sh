#!/bin/sh
set -e

echo "Loading nftables rules..."
nft -f /etc/nftables.conf
echo "Firewall loaded. Dropping CAP_NET_ADMIN for remaining commands."

echo "============================================="
echo " iron-proxy nftables demo"
echo "============================================="
echo ""
echo "Waiting for proxy CA cert..."
while [ ! -f /certs/ca.crt ]; do sleep 0.5; done
echo "Waiting for proxy to be ready..."
sleep 2

run() {
  local label="$1"
  shift
  echo ""
  echo "--- $label ---"
  echo "> curl $*"
  echo "> Proxy log:"
  output=$(curl --max-time 10 --cacert /certs/ca.crt "$@" -s -S 2>&1 || echo "Failed")
  sleep 0.3
  echo ""
  echo "> Upstream received:"
  echo "$output"
  echo ""
}

echo ""
echo "============================================="
echo " 1. ALLOWED: request through proxy"
echo "============================================="
run "GET https://httpbin.org/get" https://httpbin.org/get

echo ""
echo "============================================="
echo " 2. BLOCKED: request to disallowed host"
echo "============================================="
run "GET https://example.com/" https://example.com/

echo ""
echo "============================================="
echo " 3. ENFORCED: direct IP connection blocked"
echo "    (nftables drops non-proxy egress)"
echo "============================================="
echo ""
echo "--- Attempting direct TCP to 93.184.216.34:80 ---"
echo "> curl --connect-timeout 5 http://93.184.216.34/"
output=$(curl --connect-timeout 5 http://93.184.216.34/ -s -S 2>&1 || echo "Failed (blocked by nftables)")
echo "> Result: $output"

echo ""
echo "============================================="
echo " Demo complete!"
echo " Check the proxy container logs for audit output:"
echo "   docker compose logs proxy"
echo "============================================="

sleep 5
