#!/bin/bash
echo "=== SMOKE TEST v2 ==="

# Test 1: Login page
echo -n "1. GET /login: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test 2: CSRF handshake + login as jamolbek (admin)
echo -n "2. POST /login (jamolbek): "
CSRF=$(curl -c /tmp/st_cookies.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
HTTP=$(curl -c /tmp/st_cookies.txt -b /tmp/st_cookies.txt -s -o /dev/null -w '%{http_code}' -L -X POST http://localhost:3000/login -d "username=jamolbek&password=admin123&_csrf=$CSRF" -H 'Content-Type: application/x-www-form-urlencoded')
if [ "$HTTP" == "200" ]; then 
    echo "PASS (HTTP $HTTP)"
    # Test 3: Admin dashboard with same session
    echo -n "3. GET /admin (session): "
    ADM=$(curl -b /tmp/st_cookies.txt -s -o /dev/null -w '%{http_code}' http://localhost:3000/admin)
    echo "$ADM ($([[ $ADM == 200 ]] && echo 'PASS' || echo 'FAIL'))"
else 
    echo "FAIL (HTTP $HTTP)"
fi

# Test 4: Login as teacher1
echo -n "4. Teacher login: "
CSRF2=$(curl -c /tmp/st_cookies2.txt -s http://localhost:3000/login | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/name="_csrf" value="//' | sed 's/"//')
HTTP2=$(curl -c /tmp/st_cookies2.txt -b /tmp/st_cookies2.txt -s -o /dev/null -w '%{http_code}' -L -X POST http://localhost:3000/login -d "username=Mr_Farrukh&password=teacher123&_csrf=$CSRF2" -H 'Content-Type: application/x-www-form-urlencoded')
echo "$HTTP2 ($([[ $HTTP2 == 200 ]] && echo 'PASS' || echo 'FAIL'))"

# Test 5: Health
echo -n "5. GET /health: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)
echo "$CODE ($([[ $CODE == 200 ]] && echo 'PASS' || echo 'FAIL'))"

echo "=== DONE ==="
