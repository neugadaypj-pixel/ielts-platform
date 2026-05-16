#!/bin/bash
rm -f /tmp/test-cookies.txt

echo "=== GET /login ==="
CSRF=$(curl -s -c /tmp/test-cookies.txt http://localhost:3000/login | grep -oP 'value="\K[^"]+' | head -1)
echo "CSRF: $CSRF"

echo "=== POST /login (no redirect) ==="
curl -s -c /tmp/test-cookies.txt -b /tmp/test-cookies.txt -D /tmp/login-headers.txt -o /dev/null -d "username=jamolbek&password=Admin123&_csrf=$CSRF" http://localhost:3000/login
echo "Login response:"
grep -E 'HTTP|Location|Set-Cookie' /tmp/login-headers.txt

echo "=== GET /admin (Direct, 60s timeout) ==="
time curl -s -b /tmp/test-cookies.txt -o /dev/null -w "HTTP: %{http_code} Time: %{time_total}s\n" --max-time 60 http://localhost:3000/admin

echo "=== SERVER LOGS ==="
tail -5 /home/ubuntu/.pm2/logs/test-platform-out.log
