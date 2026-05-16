#!/bin/bash
# Clean debug test
rm -f /tmp/debug_cookies.txt

# Step 1: Get login page & CSRF
echo "=== STEP 1: GET /login ==="
curl -c /tmp/debug_cookies.txt -s -D - http://localhost:3000/login | head -10

echo ""
CSRF=$(grep -o 'name="_csrf" value="[^"]*"' /tmp/curl_login.html 2>/dev/null || curl -c /tmp/debug_cookies.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
echo "CSRF: $CSRF"

# Step 2: POST login (NO -L, just see the redirect)
echo ""
echo "=== STEP 2: POST /login ==="
curl -c /tmp/debug_cookies.txt -b /tmp/debug_cookies.txt -s -D - -o /dev/null -X POST http://localhost:3000/login \
  -d "username=jamolbek&password=admin123&_csrf=$CSRF" \
  -H 'Content-Type: application/x-www-form-urlencoded'

echo ""
echo "=== COOKIE JAR ==="
cat /tmp/debug_cookies.txt

echo ""
echo "=== STEP 3: Follow redirect ==="
curl -c /tmp/debug_cookies.txt -b /tmp/debug_cookies.txt -s -D - -o /dev/null -w 'HTTP: %{http_code}' http://localhost:3000/admin
