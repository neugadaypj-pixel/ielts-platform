#!/bin/bash
# Test: login with correct credentials and follow redirect to /admin
COOKIE_JAR=/tmp/login-test-cookies.txt
rm -f $COOKIE_JAR

# Step 1: GET /login to get CSRF token
echo "=== STEP 1: GET /login ==="
CSRF=$(curl -s -c $COOKIE_JAR http://localhost:3000/login | grep -oP 'name="_csrf"\s+value="([^"]+)"' | grep -oP 'value="([^"]+)"' | cut -d'"' -f2)
echo "CSRF Token: $CSRF"

if [ -z "$CSRF" ]; then
    echo "ERROR: Could not extract CSRF token"
    exit 1
fi

# Step 2: POST /login with correct credentials
echo ""
echo "=== STEP 2: POST /login (jamolbek / Admin123) ==="
LOGIN_RESULT=$(curl -s -c $COOKIE_JAR -b $COOKIE_JAR -w "\nHTTP_CODE:%{http_code}\nREDIRECT:%{redirect_url}\nTIME:%{time_total}" -L --max-time 60 -d "username=jamolbek&password=Admin123&_csrf=$CSRF" http://localhost:3000/login 2>&1)
echo "$LOGIN_RESULT" | tail -20

# Step 3: Try /admin directly with session cookie
echo ""
echo "=== STEP 3: GET /admin with session ==="
curl -s -b $COOKIE_JAR -o /dev/null -w "Admin HTTP: %{http_code}, Time: %{time_total}s\n" --max-time 60 http://localhost:3000/admin

echo ""
echo "=== DONE ==="
