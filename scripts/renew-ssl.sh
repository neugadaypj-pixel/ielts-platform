#!/bin/bash
# ==============================================================
# SSL Certificate Renewal Script
# Run via cron monthly or use certbot's auto-renewal.
# ==============================================================
set -euo pipefail

DOMAIN="${1:-}"

if [ -z "$DOMAIN" ]; then
    echo "Usage: $0 <your-domain.com>"
    exit 1
fi

echo "Renewing SSL certificate for $DOMAIN..."

# Stop nginx to free port 80
docker compose -f /opt/ielts-platform/docker-compose.prod.yml stop nginx

# Renew certificate
certbot renew --force-renewal

# Copy renewed certs
cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem /opt/ielts-platform/nginx/ssl/
cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem   /opt/ielts-platform/nginx/ssl/

# Restart nginx
docker compose -f /opt/ielts-platform/docker-compose.prod.yml up -d nginx

echo "SSL certificate renewed successfully for $DOMAIN"
