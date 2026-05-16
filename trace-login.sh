#!/bin/bash
echo "=== DETAILED LOGIN TRACE ==="
rm -f /tmp/ft_cookies.txt

# Get CSRF
echo "--- Getting CSRF ---"
CSRF=$(curl -c /tmp/ft_cookies.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
echo "CSRF: $CSRF"
echo "Initial cookies:"
cat /tmp/ft_cookies.txt

# Login WITHOUT following redirects
echo ""
echo "--- POST /login (no redirect) ---"
RESP=$(curl -c /tmp/ft_cookies.txt -b /tmp/ft_cookies.txt -s -D - -o /tmp/ft_body.txt -X POST http://localhost:3000/login \
  -d "username=jamolbek&password=Admin123%21&_csrf=$CSRF" \
  -H 'Content-Type: application/x-www-form-urlencoded')
echo "$RESP"

echo ""
echo "Cookies after login:"
cat /tmp/ft_cookies.txt

echo ""
echo "Response body first 200 chars:"
head -c 200 /tmp/ft_body.txt

echo ""
echo "--- Now GET /admin ---"
ADMIN_RESP=$(curl -b /tmp/ft_cookies.txt -s -D - -o /dev/null http://localhost:3000/admin)
echo "$ADMIN_RESP"
