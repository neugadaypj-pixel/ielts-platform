#!/bin/bash
# DuckDNS auto-update script
# Get your token from https://duckdns.org (shown on your domains page)
# Save it in ~/duckdns-token file on the VM

TOKEN=$(cat ~/duckdns-token 2>/dev/null)
if [ -z "$TOKEN" ]; then
    echo "ERROR: ~/duckdns-token not found. Put your DuckDNS token in this file."
    exit 1
fi

curl -s "https://www.duckdns.org/update?domains=synergyacademy&token=${TOKEN}&ip="
echo ""
