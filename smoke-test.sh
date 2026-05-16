#!/bin/bash
echo "=== SMOKE TEST ==="

# Test 1: Login page
echo -n "1. GET /login: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test 2: CSRF handshake + login
echo -n "2. POST /login (admin): "
CSRF=$(curl -c /tmp/cookies.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
FINAL=$(curl -c /tmp/cookies.txt -b /tmp/cookies.txt -s -w '\n%{http_code}' -L -X POST http://localhost:3000/login -d "username=admin&password=admin123&_csrf=$CSRF" -H 'Content-Type: application/x-www-form-urlencoded')
HTTP=$(echo "$FINAL" | tail -1)
if [ "$HTTP" == "200" ]; then echo "PASS (HTTP $HTTP)"; else echo "FAIL (HTTP $HTTP)"; fi

# Test 3: Admin dashboard
echo -n "3. GET /admin: "
CODE=$(curl -b /tmp/cookies.txt -s -o /dev/null -w '%{http_code}' http://localhost:3000/admin)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test 4: Health endpoint
echo -n "4. GET /health: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test 5: Root redirect
echo -n "5. GET / (redirect): "
CODE=$(curl -b /tmp/cookies.txt -s -o /dev/null -w '%{http_code}' http://localhost:3000/)
echo "$CODE ($([[ $CODE == 302 ]] || [[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test 6: Login as teacher
echo -n "6. Teacher dashboard page: "
CSRF2=$(curl -c /tmp/cookies2.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
CODE=$(curl -c /tmp/cookies2.txt -b /tmp/cookies2.txt -s -o /dev/null -w '%{http_code}' -L -X POST http://localhost:3000/login -d "username=teacher1&password=teacher123&_csrf=$CSRF2" -H 'Content-Type: application/x-www-form-urlencoded')
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

echo "=== DONE ==="
