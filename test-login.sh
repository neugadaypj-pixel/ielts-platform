#!/bin/bash
# Get login page with CSRF token
curl -c /tmp/cookies.txt -s http://localhost:3000/login > /tmp/login_page.html

# Extract CSRF token
CSRF=$(grep -o 'name="_csrf" value="[^"]*"' /tmp/login_page.html | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
echo "CSRF token: $CSRF"

# Now POST login
curl -c /tmp/cookies.txt -b /tmp/cookies.txt -s -w '\nHTTP_CODE: %{http_code}' -L \
  -X POST http://localhost:3000/login \
  -d "username=admin&password=admin123&_csrf=$CSRF" \
  -H 'Content-Type: application/x-www-form-urlencoded'
