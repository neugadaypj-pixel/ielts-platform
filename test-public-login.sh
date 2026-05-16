#!/bin/bash
# Test login flow via DuckDNS public URL
rm -f /tmp/test-public.txt

echo "=== Public URL Health Check ==="
curl -s -o /dev/null -w "HTTP: %{http_code} Time: %{time_total}s\n" --max-time 30 http://synergyacademy.duckdns.org/health

echo ""
echo "=== GET /login (public) ==="
CSRF=$(curl -s -c /tmp/test-public.txt http://synergyacademy.duckdns.org/login | grep -oP 'value="\K[^"]+' | head -1)
echo "CSRF: $CSRF"

echo ""
echo "=== POST /login (public, with -L redirect) ==="
curl -s -c /tmp/test-public.txt -b /tmp/test-public.txt -o /dev/null -w "LOGIN: HTTP %{http_code} in %{time_total}s redirect: %{redirect_url}\n" -L --max-time 60 \
  -d "username=jamolbek" \
  -d "password=Admin123" \
  -d "_csrf=$CSRF" \
  http://synergyacademy.duckdns.org/login

echo ""
echo "=== DONE ==="
