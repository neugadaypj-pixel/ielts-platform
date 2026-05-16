#!/bin/bash
echo "=== SMOKE TEST v3 ==="

# Test login as jamolbek (admin) with new password
echo -n "1. Admin login: "
CSRF=$(curl -c /tmp/v3.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
FINAL=$(curl -c /tmp/v3.txt -b /tmp/v3.txt -s -w '\nHTTP:%{http_code}\nLOCATION:%{redirect_url}' -L -X POST http://localhost:3000/login -d "username=jamolbek&password=Admin123!&_csrf=$CSRF" -H 'Content-Type: application/x-www-form-urlencoded')
HTTP=$(echo "$FINAL" | grep 'HTTP:' | tail -1 | cut -d: -f2)
echo "HTTP $HTTP"

# Test admin dashboard access
echo -n "2. Admin dashboard: "
CODE=$(curl -b /tmp/v3.txt -s -o /dev/null -w '%{http_code}' http://localhost:3000/admin)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test teacher login
echo -n "3. Teacher login: "
CSRF2=$(curl -c /tmp/v3t.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
HTTP2=$(curl -c /tmp/v3t.txt -b /tmp/v3t.txt -s -o /dev/null -w '%{http_code}' -L -X POST http://localhost:3000/login -d "username=Mr_Farrukh&password=teacher123&_csrf=$CSRF2" -H 'Content-Type: application/x-www-form-urlencoded')
echo "$HTTP2"

# Test other endpoints
echo -n "4. Health check: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

echo -n "5. Root redirect: "
CODE=$(curl -b /tmp/v3.txt -s -o /dev/null -w '%{http_code}' http://localhost:3000/)
echo "$CODE ($([[ $CODE == 302 ]] || [[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

echo "=== DONE ==="
