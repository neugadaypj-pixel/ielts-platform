#!/bin/bash
# ==============================================================
# VPS First-Time Setup Script — IELTS Testing Platform
# ==============================================================
# Run this ONCE on a fresh Ubuntu 22.04/24.04 VPS as root.
#
# Usage:
#   1. Copy this file to your VPS:  scp scripts/vps-setup.sh root@YOUR_IP:/root/
#   2. SSH in:                      ssh root@YOUR_IP
#   3. Run:                         chmod +x vps-setup.sh && ./vps-setup.sh
# ==============================================================

set -euo pipefail

echo "============================================"
echo " IELTS Platform — VPS Setup"
echo "============================================"

# ---- System Update ----
echo "[1/8] Updating system packages..."
apt-get update -y && apt-get upgrade -y

# ---- Install Docker ----
echo "[2/8] Installing Docker..."
apt-get install -y ca-certificates curl gnupg lsb-release
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable Docker on boot
systemctl enable docker
systemctl start docker
echo "Docker installed: $(docker --version)"

# ---- Install UFW Firewall ----
echo "[3/8] Configuring UFW firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 3001/tcp  # Uptime Kuma (optional — restrict to your IP in production)
ufw --force enable
ufw status verbose

# ---- Create App Directory ----
echo "[4/8] Creating application directory..."
mkdir -p /opt/ielts-platform
mkdir -p /opt/ielts-platform/nginx/ssl

# ---- Install Certbot (for Let's Encrypt SSL) ----
echo "[5/8] Installing Certbot..."
apt-get install -y certbot

# ---- Configure Automatic Security Updates ----
echo "[6/8] Enabling automatic security updates..."
apt-get install -y unattended-upgrades
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades

# ---- Set Up MongoDB Backup Cron Job ----
echo "[7/8] Setting up daily MongoDB backup cron job..."
cat > /opt/ielts-platform/scripts/mongo-backup.sh << 'BACKUPEOF'
#!/bin/bash
# Daily MongoDB backup — runs inside the mongodb container
BACKUP_DIR="/backups/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"
mongodump --out="$BACKUP_DIR" 2>/dev/null
# Keep only last 7 days
find /backups -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null
BACKUPEOF
chmod +x /opt/ielts-platform/scripts/mongo-backup.sh
mkdir -p /opt/ielts-platform/backups

# Add cron job (daily at 3am)
(crontab -l 2>/dev/null; echo "0 3 * * * cd /opt/ielts-platform && docker compose -f docker-compose.prod.yml exec -T mongodb /backup.sh") | crontab -

# ---- Summary ----
echo "[8/8] Setup complete!"
echo ""
echo "============================================"
echo " NEXT STEPS:"
echo "============================================"
echo ""
echo "1. Clone your repo to this VPS:"
echo "   cd /opt/ielts-platform"
echo "   git clone https://github.com/YOUR_ORG/ielts-platform.git ."
echo ""
echo "2. Set up SSL certificates:"
echo "   certbot certonly --standalone -d YOUR_DOMAIN.com"
echo "   cp /etc/letsencrypt/live/YOUR_DOMAIN/fullchain.pem nginx/ssl/"
echo "   cp /etc/letsencrypt/live/YOUR_DOMAIN/privkey.pem   nginx/ssl/"
echo ""
echo "3. Create .env file with real secrets"
echo ""
echo "4. Start the stack:"
echo "   docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "5. Access Uptime Kuma: http://YOUR_IP:3001"
echo "   (Set up monitors for https://YOUR_DOMAIN/health)"
echo ""
echo "============================================"
