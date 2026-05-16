#!/bin/bash
# Full CSRF login flow test
set -e

COOKIE_JAR=$(mktemp)

# Step 1: GET /login to obtain CSRF token + cookie
echo "=== Step 1: GET /login ==="
LOGIN_PAGE=$(curl -s -c "$COOKIE_JAR" http://localhost:3000/login)

# Extract CSRF token from hidden input
CSRF=$(echo "$LOGIN_PAGE" | grep -oP 'name="_csrf" value="\K[^"]+')
echo "CSRF Token: $CSRF"

if [ -z "$CSRF" ]; then
    echo "ERROR: Failed to extract CSRF token!"
    echo "Page excerpt:"
    echo "$LOGIN_PAGE" | head -30
    exit 1
fi

# Step 2: POST /login with CSRF token and correct credentials
echo ""
echo "=== Step 2: POST /login (jamolbek / Admin123) ==="
LOGIN_RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -d "username=jamolbek" \
    -d "password=Admin123" \
    -d "_csrf=$CSRF" \
    http://localhost:3000/login)

HTTP_CODE=$(echo "$LOGIN_RESP" | tail -1)
BODY=$(echo "$LOGIN_RESP" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Location header would be shown with -v"

# Check if we got a connect.sid cookie
echo ""
echo "=== Cookies after login ==="
cat "$COOKIE_JAR"

# Check if a session cookie was set
if grep -q "connect.sid" "$COOKIE_JAR"; then
    echo ""
    echo "SUCCESS: connect.sid cookie received!"
    
    # Step 3: Try accessing admin dashboard
    echo ""
    echo "=== Step 3: GET /admin ==="
    ADMIN_RESP=$(curl -s -w "\n%{http_code}" -b "$COOKIE_JAR" http://localhost:3000/admin)
    ADMIN_CODE=$(echo "$ADMIN_RESP" | tail -1)
    ADMIN_BODY=$(echo "$ADMIN_RESP" | sed '$d')
    echo "HTTP Status: $ADMIN_CODE"
    
    if [ "$ADMIN_CODE" = "200" ]; then
        echo "ADMIN DASHBOARD: OK"
        # Check for admin content
        if echo "$ADMIN_BODY" | grep -qi "admin"; then
            echo "Admin content detected on page"
        fi
    elif [ "$ADMIN_CODE" = "302" ]; then
        echo "Redirected - session may not be valid"
    elif [ "$ADMIN_CODE" = "403" ]; then
        echo "403 Forbidden - session auth issue"
    fi
else
    echo ""
    echo "FAIL: No connect.sid cookie - login did not create a session"
    echo "Response body excerpt:"
    echo "$BODY" | head -30
fi

rm -f "$COOKIE_JAR"
