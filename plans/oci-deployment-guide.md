# OCI Node.js Deployment Guide — $0/Month

## Keep Render as Fallback + Deploy on Oracle VM

This guide deploys [`server-oracle.js`](../server-oracle.js) on an Oracle Always Free AMD VM while **keeping Render active** as a safety net. Both servers connect to the same Oracle Autonomous Database — zero data sync issues.

**Total cost: $0/month. Render stays untouched.**

---

## Table of Contents
1. [Architecture: Dual-Provider Setup](#1-architecture-dual-provider-setup)
2. [Prerequisites](#2-prerequisites)
3. [SSH Into the VM](#3-ssh-into-the-vm)
4. [Install Node.js 20](#4-install-nodejs-20)
5. [Install Oracle Instant Client](#5-install-oracle-instant-client)
6. [Clone & Configure the App](#6-clone--configure-the-app)
7. [Test: Does It Connect to the DB?](#7-test-does-it-connect-to-the-db)
8. [PM2 — Keep the Server Alive](#8-pm2--keep-the-server-alive)
9. [Nginx Reverse Proxy](#9-nginx-reverse-proxy)
10. [SSL with Let's Encrypt + DuckDNS](#10-ssl-with-lets-encrypt--duckdns)
11. [DuckDNS Auto-Updater](#11-duckdns-auto-updater)
12. [OCI Firewall — Open Ports](#12-oci-firewall--open-ports)
13. [Auto-Deploy on Git Push](#13-auto-deploy-on-git-push)
14. [Verify Everything Works](#14-verify-everything-works)
15. [Rollback to Render (If Needed)](#15-rollback-to-render-if-needed)
16. [Maintenance & Monitoring](#16-maintenance--monitoring)

---

## 1. Architecture: Dual-Provider Setup

```
                    DuckDNS
                (synergyacademy.duckdns.org)
                        |
            +-----------+-----------+
            |                       |
     Oracle VM (Primary)     Render (Fallback)
     129.153.x.x:3000        ielts-platform-63xw.onrender.com
            |                       |
            +-------+---------------+
                    |
          Oracle Autonomous DB
          (same connection string)
```

**Key point:** Both servers read/write the **same database**. If Oracle VM has issues, switch DuckDNS back to Render's URL — zero data loss.

---

## 2. Prerequisites

Before starting, you need:

| Item | Where to Get It |
|------|----------------|
| OCI VM running Ubuntu 22.04 | Created in [oci-setup-guide.md](oci-setup-guide.md) Step 4 |
| VM's **Public IP** | OCI Console → Compute → Instances → your instance |
| SSH private key (`.key` file) | Downloaded during VM creation |
| Oracle DB wallet | Already in repo's [`wallet/`](../wallet/) folder |
| DuckDNS token | Your DuckDNS account → domain page → "token" field |
| GitHub repo URL | `https://github.com/neugadaypj-pixel/ielts-platform.git` |

---

## 3. SSH Into the VM

### Windows (PowerShell)

```powershell
# Move your key to a safe place
mkdir C:\Users\user\.ssh -Force
copy your-key.key C:\Users\user\.ssh\oci-server.key

# SSH in (replace 129.153.x.x with your VM's IP)
ssh -i C:\Users\user\.ssh\oci-server.key ubuntu@129.153.x.x
```

### Linux/Mac (Terminal)

```bash
chmod 600 ~/.ssh/oci-server.key
ssh -i ~/.ssh/oci-server.key ubuntu@129.153.x.x
```

**If SSH fails with "Permission denied":**
```bash
# Fix: Set correct key permissions
chmod 400 oci-server.key
```

**If you get "Connection refused" or timeout:** The VM's firewall (Security List) may not have port 22 open. Go to OCI Console → Networking → Virtual Cloud Networks → your VCN → Security Lists → Default Security List → Add Ingress Rules:
- Source: `0.0.0.0/0`, IP Protocol: `TCP`, Destination Port: `22`

---

## 4. Install Node.js 20

On the VM, run:

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Add NodeSource repo for Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# Install Node.js + npm
sudo apt install -y nodejs

# Verify
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x

# Install essential tools
sudo apt install -y git unzip curl nginx certbot python3-certbot-nginx
```

---

## 5. Install Oracle Instant Client

This is the same library that Render downloads in [`render-build.sh`](../render-build.sh). On the VM:

```bash
cd /opt
sudo mkdir -p oracle
cd oracle

# Download Instant Client (same version as render-build.sh)
sudo wget https://download.oracle.com/otn_software/linux/instantclient/2340000/instantclient-basic-linux.x64-23.4.0.24.05.zip

# Extract
sudo unzip instantclient-basic-linux.x64-23.4.0.24.05.zip
sudo rm instantclient-basic-linux.x64-23.4.0.24.05.zip

# Copy libaio from the repo later — or install system libaio
sudo apt install -y libaio1

# Set library path permanently
echo 'export LD_LIBRARY_PATH=/opt/oracle/instantclient_23_4:$LD_LIBRARY_PATH' | sudo tee /etc/profile.d/oracle-instantclient.sh
source /etc/profile.d/oracle-instantclient.sh

# Verify
ls /opt/oracle/instantclient_23_4/libclntsh.so
# Should show: /opt/oracle/instantclient_23_4/libclntsh.so
```

---

## 6. Clone & Configure the App

```bash
# Create app directory
mkdir -p /home/ubuntu/app
cd /home/ubuntu/app

# Clone the repo
git clone https://github.com/neugadaypj-pixel/ielts-platform.git .
# OR if private: git clone git@github.com:neugadaypj-pixel/ielts-platform.git .

# Copy wallet files (if not in repo — they should be)
ls wallet/   # Should show cwallet.sso, ewallet.p12, tnsnames.ora, sqlnet.ora

# Install Node dependencies
npm install
```

### Create `.env` file

```bash
nano .env
```

Paste this (adjust values as needed):

```env
# === Oracle DB Connection (same as Render) ===
DB_USER=IELTS_APP
DB_PASSWORD=IeltsApp@2026#Secure
DB_CONNECT_STRING=testplatform_high
TNS_ADMIN=/home/ubuntu/app/wallet

# === Session Secret ===
SESSION_SECRET=your-session-secret-here-change-me

# === Port ===
PORT=3000
NODE_ENV=production

# === Backblaze B2 (same as Render) ===
B2_KEY_ID=your-b2-key-id
B2_APP_KEY=your-b2-app-key
B2_BUCKET=your-bucket-name
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com

# === DeepSeek AI ===
DEEPSEEK_API_KEY=your-deepseek-api-key

# === Sentry (optional) ===
SENTRY_DSN=your-sentry-dsn

# === DuckDNS ===
DUCKDNS_DOMAIN=synergyacademy.duckdns.org
```

Save: `Ctrl+O` → Enter → `Ctrl+X`

---

## 7. Test: Does It Connect to the DB?

```bash
cd /home/ubuntu/app
source /etc/profile.d/oracle-instantclient.sh
LD_LIBRARY_PATH=/opt/oracle/instantclient_23_4:$LD_LIBRARY_PATH node -e "
const { execute } = require('./database/connection');
(async () => {
    const result = await execute('SELECT COUNT(*) AS CNT FROM users', {});
    console.log('✅ Connected! Users in DB:', result.rows[0].CNT);
})();
"
```

Expected output: `✅ Connected! Users in DB: 29` (or however many users you have).

**If this fails:**

| Error | Fix |
|-------|-----|
| `ORA-12154: TNS:could not resolve the connect identifier` | Check `TNS_ADMIN` path in `.env`. Make sure `tnsnames.ora` is in the wallet folder. |
| `ORA-12541: TNS:no listener` | The DB might be stopped. Go to OCI Console → Autonomous DB → start it. |
| `ORA-28759: failure to open file` | Wallet file permissions: `chmod 644 wallet/*` |
| `Cannot find module 'oracledb'` | Run `npm install oracledb` again |
| `DPI-1047: Cannot locate a 64-bit Oracle Client library` | `libaio1` not installed: `sudo apt install -y libaio1` |

---

## 8. PM2 — Keep the Server Alive

PM2 restarts the app if it crashes and starts it automatically on VM reboot.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the app
cd /home/ubuntu/app
source /etc/profile.d/oracle-instantclient.sh
LD_LIBRARY_PATH=/opt/oracle/instantclient_23_4:$LD_LIBRARY_PATH pm2 start server-oracle.js --name ielts-platform --env production

# Save the PM2 process list (auto-restart on reboot)
pm2 save

# Configure PM2 to start on system boot
pm2 startup systemd
# Follow the command it prints (copy-paste the sudo command)

# Check status
pm2 status     # Should show ielts-platform: online
pm2 logs       # See live logs

# Useful PM2 commands:
# pm2 restart ielts-platform   — restart
# pm2 stop ielts-platform      — stop
# pm2 logs ielts-platform      — view logs
# pm2 monit                     — CPU/memory monitor
```

---

## 9. Nginx Reverse Proxy

Nginx sits in front of Node.js, handles SSL, and serves static files.

```bash
# Create Nginx config
sudo nano /etc/nginx/sites-available/ielts-platform
```

Paste:

```nginx
server {
    listen 80;
    server_name synergyacademy.duckdns.org;

    # Increase buffer for large responses
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Increase timeouts for slow Oracle queries
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }

    # Serve static files directly (better performance)
    location /public/ {
        alias /home/ubuntu/app/public/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Save and enable:

```bash
# Create symlink to enable the site
sudo ln -s /etc/nginx/sites-available/ielts-platform /etc/nginx/sites-enabled/

# Remove default Nginx page
sudo rm /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t
# Should say: "syntax is ok" and "test is successful"

# Reload Nginx
sudo systemctl reload nginx
```

**Now your app is accessible at `http://YOUR_VM_IP`** (port 80). SSL comes next.

---

## 10. SSL with Let's Encrypt + DuckDNS

```bash
# Stop PM2 temporarily (certbot needs port 80)
pm2 stop ielts-platform

# Get SSL certificate
sudo certbot --nginx -d synergyacademy.duckdns.org

# Follow the prompts:
# - Enter email: your email
# - Agree to terms: Y
# - Share email with EFF: N (or Y, your choice)
# - Redirect HTTP to HTTPS: 2 (redirect)

# Restart PM2
pm2 start ielts-platform

# Test SSL
curl -I https://synergyacademy.duckdns.org
# Should return HTTP/2 200

# Auto-renewal (Let's Encrypt certs expire every 90 days)
sudo certbot renew --dry-run   # Test renewal
# The real renewal runs automatically via systemd timer
sudo systemctl status certbot.timer
```

**⚠️ Important:** Before running certbot, make sure DuckDNS is pointing to your OCI VM's IP (not Render). See next step.

---

## 11. DuckDNS Auto-Updater

DuckDNS needs to know your VM's IP. Create a cron job to update it every 5 minutes.

```bash
# Create the update script
nano ~/duckdns-update.sh
```

Paste:

```bash
#!/bin/bash
# Replace YOUR_TOKEN with your actual DuckDNS token
curl -s "https://www.duckdns.org/update?domains=synergyacademy&token=YOUR_TOKEN&ip="
echo ""
```

```bash
chmod +x ~/duckdns-update.sh

# Add to crontab (every 5 minutes)
crontab -e
# Add this line:
*/5 * * * * /home/ubuntu/duckdns-update.sh >> /home/ubuntu/duckdns-update.log 2>&1
```

**Test it:**
```bash
~/duckdns-update.sh
# Should return: OK
```

**To switch back to Render:** Change the DuckDNS IP to Render's IP instead of leaving `&ip=` blank (which auto-detects the VM's IP). Run:
```bash
curl "https://www.duckdns.org/update?domains=synergyacademy&token=YOUR_TOKEN&ip=YOUR_RENDER_IP"
```

---

## 12. OCI Firewall — Open Ports

The OCI VM's network security list blocks all ports by default except 22 (SSH). You need to open 80 and 443.

1. Go to **OCI Console** → **Networking** → **Virtual Cloud Networks**
2. Click your VCN (created automatically with the VM)
3. Click **Security Lists** → **Default Security List**
4. Click **Add Ingress Rules**
5. Add these rules:

| Source | IP Protocol | Destination Port | Description |
|--------|------------|-----------------|-------------|
| `0.0.0.0/0` | TCP | `80` | HTTP |
| `0.0.0.0/0` | TCP | `443` | HTTPS |

6. Click **Add Ingress Rules**

Also verify **Egress Rules** allow outbound traffic (should be default: all ports open). The app needs outbound access for:
- Oracle DB (port 1522)
- Backblaze B2 (port 443)
- DeepSeek API (port 443)
- DuckDNS (port 443)

---

## 13. Auto-Deploy on Git Push

Optional — automatic deployment when you push to GitHub. There are two approaches:

### Option A: Simple — Cron Git Pull (Recommended for Simplicity)

```bash
nano ~/update-app.sh
```

```bash
#!/bin/bash
cd /home/ubuntu/app
git pull origin main
npm install --production
pm2 restart ielts-platform
echo "[$(date)] Deployed successfully"
```

```bash
chmod +x ~/update-app.sh
crontab -e
# Add: Run every 2 minutes
*/2 * * * * /home/ubuntu/update-app.sh >> /home/ubuntu/deploy.log 2>&1
```

This keeps Render behavior: push to GitHub, and within 2 minutes the OCI VM auto-deploys.

### Option B: GitHub Webhook (More Precise)

If you want instant deploys (no 2-minute wait):

```bash
# Install a simple webhook server
sudo npm install -g github-webhook-handler

# Create webhook script (advanced — see GitHub webhook docs)
# This is optional; Option A works fine for most cases
```

---

## 14. Verify Everything Works

### Check List

```
☐ SSH: Can you SSH into the VM?
☐ Node.js: `node --version` shows v20.x.x
☐ Oracle Client: `ls /opt/oracle/instantclient_23_4/libclntsh.so` exists
☐ DB Connection: Test script in Step 7 returns user count
☐ App runs: `pm2 status` shows ielts-platform: online
☐ HTTP access: `curl http://YOUR_VM_IP` returns HTML (login page)
☐ HTTPS access: `curl -I https://synergyacademy.duckdns.org` returns 200
☐ Login works: Open https://synergyacademy.duckdns.org and log in
☐ Dashboard loads: Teacher dashboard loads with correct data
☐ Render still works: https://ielts-platform-63xw.onrender.com still loads
☐ DuckDNS update: `~/duckdns-update.sh` returns OK
```

### Monitor Logs

```bash
# App logs
pm2 logs ielts-platform --lines 50

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log

# System resource usage
htop   # Install with: sudo apt install -y htop
```

---

## 15. Rollback to Render (If Needed)

If the OCI VM has issues, switching back to Render takes 30 seconds:

### Option 1: DuckDNS Pointing Back to Render

```bash
# Get Render's IP
ping ielts-platform-63xw.onrender.com
# Note the IP (it changes periodically)

# Update DuckDNS to point to Render
curl "https://www.duckdns.org/update?domains=synergyacademy&token=YOUR_TOKEN&ip=RENDER_IP"
```

### Option 2: Use Render URL Directly

Your Render URL `https://ielts-platform-63xw.onrender.com` still works independently. Users can use it directly if DuckDNS is pointing to the failing OCI VM.

### No Data Loss

Both servers connect to the **same Oracle DB**. Any data created on the OCI server is immediately available on Render (and vice versa). No migration, no sync — it's the same database.

---

## 16. Maintenance & Monitoring

### Daily Checks (can be automated)

```bash
# Check PM2 status
pm2 status

# Check disk space
df -h /   # Should be well under 45GB

# Check memory
free -h   # Node.js uses ~200-400MB typically

# Check auto-renewal
sudo certbot renew --dry-run
```

### Update Dependencies (Monthly)

```bash
cd /home/ubuntu/app
git pull origin main
npm install
pm2 restart ielts-platform
```

### Backup (Important!)

Your data is in Oracle Autonomous DB which has automatic backups. But for extra safety:

```bash
# Run the existing backup script
cd /home/ubuntu/app
node backup-database-oracle.js
```

(This script already exists in the repo.)

### Oracle DB Maintenance

Oracle Autonomous Database is self-managing (patches, backups, tuning). You don't need to do anything. Just make sure it's **not stopped** — check OCI Console occasionally.

---

## Quick Reference Card

| Task | Command |
|------|---------|
| SSH to VM | `ssh -i ~/.ssh/oci-server.key ubuntu@VM_IP` |
| Restart app | `pm2 restart ielts-platform` |
| View logs | `pm2 logs ielts-platform` |
| Git update | `cd /home/ubuntu/app && git pull && pm2 restart ielts-platform` |
| Check DB connection | `node -e "require('./database/connection').execute('SELECT 1 FROM DUAL').then(r => console.log('OK', r.rows))"` |
| Renew SSL | `sudo certbot renew` |
| Switch DuckDNS to Render | `curl "https://www.duckdns.org/update?domains=synergyacademy&token=TOKEN&ip=RENDER_IP"` |
| Switch DuckDNS to OCI | `~/duckdns-update.sh` (auto-detects OCI IP) |

---

## Summary

| What | Where | Status |
|------|-------|--------|
| Database | Oracle Autonomous DB | ✅ Already running |
| Primary Server | OCI AMD VM (1GB) | ⏳ This guide sets it up |
| Fallback Server | Render Free Tier | ✅ Stays active |
| Domain | synergyacademy.duckdns.org | Points to OCI VM |
| SSL | Let's Encrypt via certbot | Auto-renewing |
| Process Manager | PM2 | Auto-restart + boot |
| Reverse Proxy | Nginx | HTTP→HTTPS redirect |
