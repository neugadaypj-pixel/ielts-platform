#!/bin/bash
# Direct session test - get CSRF, login, then access admin
CSRF=$(curl -c /tmp/sess.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')

# Login without -L to properly capture session cookie
echo -n "Login POST: "
curl -c /tmp/sess.txt -b /tmp/sess.txt -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/login \
  -d "username=admin&password=admin123&_csrf=$CSRF" \
  -H 'Content-Type: application/x-www-form-urlencoded'

# Now access admin with the session cookie
echo ""
echo -n "Admin GET: "
curl -b /tmp/sess.txt -s -w '\n%{http_code}' http://localhost:3000/admin | tail -1
