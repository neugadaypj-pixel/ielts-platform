#!/bin/bash
rm -f /tmp/test-cookies3.txt

CSRF=$(curl -s -c /tmp/test-cookies3.txt http://localhost:3000/login | grep -oP 'value="\K[^"]+' | head -1)
echo "CSRF: $CSRF"

echo "=== POST /login (no -L, no redirect) ==="
curl -s -c /tmp/test-cookies3.txt -b /tmp/test-cookies3.txt -o /dev/null -w "HTTP: %{http_code} Time: %{time_total}s\n" --max-time 30 -d "username=jamolbek" -d "password=Admin123" -d "_csrf=$CSRF" http://localhost:3000/login

echo ""
echo "=== Sleep 2s, then GET /admin ==="
sleep 2
curl -s -b /tmp/test-cookies3.txt -o /dev/null -w "HTTP: %{http_code} Time: %{time_total}s\n" --max-time 30 http://localhost:3000/admin

echo ""
echo "=== SessionStore logs ==="
grep -i 'SessionStore\|Admin dashboard' /home/ubuntu/.pm2/logs/test-platform-out.log | tail -30
