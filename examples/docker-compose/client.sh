#!/bin/sh
set -e

echo "Installing curl..."
apk add --no-cache curl

echo "============================================="
echo " iron-proxy demo client"
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
echo " 1. ALLOWED: request to httpbin.org"
echo "============================================="
run "GET https://httpbin.org/get" https://httpbin.org/get

echo ""
echo "============================================="
echo " 2. BLOCKED: request to disallowed host"
echo "============================================="
run "GET https://example.com/" https://example.com/

echo ""
echo "============================================="
echo " 3. SECRET SWAP: proxy token in Authorization"
echo "    (httpbin echoes headers back — look for"
echo "     the real key in the response)"
echo "============================================="
run "GET with proxy token" \
  -H "Authorization: Bearer proxy-openai-abc123" \
  https://httpbin.org/headers

echo ""
echo "============================================="
echo " 4. SECRET SWAP: proxy token in custom header"
echo "    (INTERNAL_TOKEN matches all headers)"
echo "============================================="
run "GET with internal token" \
  -H "X-Internal: proxy-internal-tok" \
  https://httpbin.org/headers

echo ""
echo "============================================="
echo " 5. SECRET SWAP: token in query parameter"
echo "============================================="
run "GET with query param token" \
  "https://httpbin.org/get?token=proxy-openai-abc123&q=hello"

echo ""
echo "============================================="
echo " Demo complete!"
echo " Check the proxy container logs for audit output:"
echo "   docker compose logs proxy"
echo "============================================="

sleep 5
