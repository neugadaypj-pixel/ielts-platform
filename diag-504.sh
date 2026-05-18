#!/bin/bash
echo '=== Latest Nginx Error Log ==='
sudo tail -15 /var/log/nginx/error.log

echo ''
echo '=== Latest PM2 Out Log ==='
tail -15 /home/ubuntu/.pm2/logs/test-platform-out.log

echo ''
echo '=== Latest PM2 Error Log ==='
tail -10 /home/ubuntu/.pm2/logs/test-platform-error.log

echo ''
echo '=== Test POST /login via localhost ==='
CSRF=$(curl -s -c /tmp/ctest.txt http://localhost:3000/login | grep -oP 'value="\K[^"]+' | head -1)
echo "CSRF: $CSRF"
curl -s -c /tmp/ctest.txt -b /tmp/ctest.txt -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" --max-time 10 -d "username=jamolbek&password=Admin123&_csrf=$CSRF" http://localhost:3000/login

echo ''
echo '=== Test POST /login via DuckDNS ==='
CSRF2=$(curl -s -c /tmp/ctest2.txt http://synergyacademy.duckdns.org/login | grep -oP 'value="\K[^"]+' | head -1)
echo "CSRF: $CSRF2"
curl -s -c /tmp/ctest2.txt -b /tmp/ctest2.txt -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" --max-time 30 -d "username=jamolbek&password=Admin123&_csrf=$CSRF2" http://synergyacademy.duckdns.org/login

echo ''
echo '=== Oracle Connection Count (via local endpoint) ==='
curl -s --max-time 5 http://localhost:3000/health
