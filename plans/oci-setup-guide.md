# Oracle Cloud Setup Guide — Step by Step

This guide walks you through creating your Oracle Cloud account and setting up all the free resources. Follow each step in order — don't skip ahead.

**Total cost: $0. You will never be charged.**

---

## Step 1: Create Your Oracle Cloud Account

1. Go to **https://www.oracle.com/cloud/free/**
2. Click the big **"Start for free"** button
3. Fill in:
   - **Email**: use a real email (you'll need to verify it)
   - **Cloud Account Name**: pick something like `ielts-platform` (write this down!)
   - **Home Region**: pick the one closest to you. For Uzbekistan (Tashkent), the closest are:
     - **Germany Central (Frankfurt)** — usually best for Central Asia
     - **UAE East (Dubai)** — also close
   - **Name, Address, Phone** — real info
4. **Credit card**: You MUST enter a credit/debit card. Oracle does a $1 verification charge that is immediately refunded. **You will NOT be charged** as long as you only use Always Free resources.
5. Verify your email (check inbox for verification link)
6. After verification, wait 5-15 minutes for account provisioning

---

## Step 2: Log Into the OCI Console

1. Go to **https://cloud.oracle.com**
2. Click **"Sign in to Oracle Cloud"**
3. Enter your **Cloud Account Name** (the one you picked in Step 1)
4. Sign in with your username (usually your email) and password

After login, you'll see the OCI Console dashboard. It looks overwhelming — don't worry, you only need a few things.

---

## Step 3: Create a Compartment

Think of a compartment as a folder that holds all your resources together.

1. In the top-left hamburger menu (☰), go to **Identity & Security → Compartments**
2. Click **"Create Compartment"**
3. Fill in:
   - **Name**: `test-platform`
   - **Description**: `IELTS Test Platform resources`
4. Click **"Create Compartment"**

**Important:** After creating the compartment, **switch to it** using the dropdown at the top-left of the page (it says something like "root" — change it to "test-platform"). All resources you create should go into this compartment so they're organized.

---

## Step 4: Create the Free Compute VM

This is the server that will run your Node.js app.

1. ☰ Menu → **Compute → Instances**
2. Make sure you're in the `test-platform` compartment (check the dropdown on the left sidebar)
3. Click **"Create instance"**
4. Fill in:

   | Field | Value |
   |---|---|
   | Name | `test-platform-server` |
   | Placement | Leave default |
   | **Image** | Click "Change image" → choose **Canonical Ubuntu 22.04** |
   | **Shape** | Click "Change shape" → under "Specialty and legacy" select **VM.Standard.E2.1.Micro** (this is the Always Free one) |
   | OCPU count | `1` (it shows 1/8 OCPU — that's the free one) |
   | Memory | `1 GB` |

5. **Networking**: Leave default (it will create a VCN automatically)
6. **SSH Keys**: This is how you'll connect to the server.
   - Choose **"Generate a key pair for me"**
   - **DOWNLOAD THE PRIVATE KEY** — it will download a `.key` file. **Save this somewhere safe!** You cannot download it again.
   - Also download the public key
7. **Boot volume**: Leave default (it'll be ~47GB, well within the 200GB free limit)
8. Click **"Create"**

Wait 2-3 minutes for the instance to provision. When it's ready, you'll see **"Running"** in green.

9. Click on your instance name. Find the **"Public IP address"** — write this down. It looks like `129.153.x.x`.

---

## Step 5: Create the Free Oracle Autonomous Database

1. ☰ Menu → **Oracle Database → Autonomous Database**
2. Click **"Create Autonomous Database"**
3. Fill in:

   | Field | Value |
   |---|---|
   | Compartment | `test-platform` |
   | Display name | `TestPlatformDB` |
   | Database name | `TESTPLATFORM` |
   | **Workload type** | **Transaction Processing** |
   | **Deployment type** | **Serverless** |
   | **Always Free** | ✅ **Toggle this ON** — this is critical! |
   | Database version | 19c or 23ai (either is fine for Always Free) |
   | **OCPU count** | `1` (disabled — set by Always Free) |
   | **Storage** | `20 GB` (disabled — set by Always Free) |
   | **Administrator password** | Create a strong password. **WRITE IT DOWN** — you'll need this for the `.env` file |

4. Under **"Choose network access"**:
   - Select **"Secure access from everywhere"**
   - OR select **"Virtual cloud network access"** if you want only your VM to reach it (more secure)

5. Click **"Create Autonomous Database"**

Wait 3-5 minutes. When the status shows **"Available"** (green), proceed.

---

## Step 6: Download the Database Wallet

The wallet is a ZIP file containing connection certificates. Your app needs this to connect to the database.

1. On your Autonomous Database page, click **"Database connection"**
2. Under **"Wallet"**, click **"Download wallet"**
3. Set a wallet password (you can use the same admin password — **write it down**)
4. Click **"Download"** — you'll get a file like `Wallet_TestPlatformDB.zip`
5. Save this file — you'll upload it to your VM later

⚠️ **The wallet ZIP contains your connection strings and SSL certificates. Keep it safe.**

---

## Step 7: Open the Database Port (if using "Secure access from everywhere")

If you chose "Secure access from everywhere" in Step 5, **you must also enable access**:

1. On your Autonomous Database page, click **"Edit"** next to "Access Control List"
2. Under **"IP notation type"**, choose **"IP Address"**
3. Add an entry: `0.0.0.0/0` (allows all IPs — needed because your VM's public IP may change)
4. Click **"Save changes"**

---

## Step 8: Connect to Your VM via SSH

### On Windows (your machine):

Since you're on **Windows 11 + cmd.exe**, here's how to connect:

1. First, OpenSSH should already be installed on Windows 11. Verify:
   ```
   where ssh
   ```
2. Move your downloaded private key (the `.key` file from Step 4) to a convenient location:
   ```
   mkdir %USERPROFILE%\.ssh
   move Downloads\ssh-key-*.key %USERPROFILE%\.ssh\oci-key.key
   ```
3. Set proper permissions on the key (in PowerShell or cmd as admin):
   - Right-click the `.key` file → Properties → Security → Advanced
   - Disable inheritance → "Convert inherited permissions"
   - Remove all entries except your user → give your user Full Control
   - OR use this from an admin PowerShell:
     ```powershell
     icacls %USERPROFILE%\.ssh\oci-key.key /inheritance:r /grant:r "%USERNAME%:R"
     ```
4. Connect:
   ```
   ssh -i %USERPROFILE%\.ssh\oci-key.key ubuntu@YOUR_VM_PUBLIC_IP
   ```
   Replace `YOUR_VM_PUBLIC_IP` with the IP you wrote down in Step 4.

5. When prompted "Are you sure you want to continue connecting?" type `yes`

If you get "UNPROTECTED PRIVATE KEY FILE" warning, fix permissions:
```
icacls %USERPROFILE%\.ssh\oci-key.key /inheritance:r /grant:r "%USERNAME%:R"
```

---

## Step 9: Initial VM Setup (run these on your VM)

Once connected via SSH, run these commands in order:

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Verify installations
node --version   # should show v22.x.x
npm --version    # should show 10.x.x

# 4. Install nginx (web server/reverse proxy)
sudo apt install -y nginx

# 5. Install PM2 (keeps your app running)
sudo npm install -g pm2

# 6. Install unzip (for Oracle wallet)
sudo apt install -y unzip

# 7. Install Oracle Instant Client (needed for node-oracledb)
cd /tmp
wget https://download.oracle.com/otn_software/linux/instantclient/2115000/instantclient-basic-linux.x64-21.15.0.0.0dbru.zip
sudo mkdir -p /opt/oracle
sudo unzip instantclient-basic-linux.x64-21.15.0.0.0dbru.zip -d /opt/oracle
sudo sh -c 'echo /opt/oracle/instantclient_21_15 > /etc/ld.so.conf.d/oracle-instantclient.conf'
sudo ldconfig

# 8. Create app directory
mkdir ~/test-platform

# 9. Create a swap file (extra "fake RAM" — helps with 1GB limit)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 10. Verify everything
free -h          # should show 2GB swap
nginx -v         # should show version
pm2 -v           # should show version
```

---

## Step 10: Upload Files to Your VM

### Upload the Oracle Wallet

From your Windows machine, open a **new terminal** (in VS Code or cmd):

```
scp -i %USERPROFILE%\.ssh\oci-key.key Downloads\Wallet_TestPlatformDB.zip ubuntu@YOUR_VM_PUBLIC_IP:~/
```

Then back in your SSH session on the VM:

```bash
mkdir ~/oracle-wallet
unzip ~/Wallet_TestPlatformDB.zip -d ~/oracle-wallet
rm ~/Wallet_TestPlatformDB.zip
ls ~/oracle-wallet    # should show tnsnames.ora, cwallet.sso, etc.
```

### Upload your project

From your Windows machine:

```
scp -i %USERPROFILE%\.ssh\oci-key.key -r c:\Users\user\Desktop\web\test-platform ubuntu@YOUR_VM_PUBLIC_IP:~/test-platform/
```

⚠️ This copies everything including `node_modules/` which is slow. Better approach:

```
# On your Windows machine, create a zip without node_modules
cd c:\Users\user\Desktop\web\test-platform
# Use PowerShell to create zip (or just skip this and use git)
```

**Best approach — use git:**

On the VM:
```bash
# Install git
sudo apt install -y git

# Clone your repo
cd ~/test-platform
git clone <your-github-repo-url> .

# Or if not on GitHub, upload via scp without node_modules
```

Then on your Windows machine (exclude node_modules):
```
# In PowerShell:
Compress-Archive -Path * -DestinationPath test-platform.zip
# Exclude node_modules by creating a .zipignore or copying manually
```

---

## Step 11: Configure Environment

On the VM, create the `.env` file:

```bash
cd ~/test-platform
nano .env
```

Paste these settings (replace the placeholders with your values):

```env
# ENVIRONMENT
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# ORACLE DATABASE (from your ATP details)
DB_USER=ADMIN
DB_PASSWORD=your_atp_admin_password
DB_CONNECT_STRING=(description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1522)(host=adb.REGION.oraclecloud.com))(connect_data=(service_name=YOURDB_tp.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))

# ORACLE WALLET PATH
TNS_ADMIN=/home/ubuntu/oracle-wallet

# SESSION
SESSION_SECRET=your-random-64-character-secret-string-here-change-this

# BACKBLAZE B2 (keep your existing values)
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_BUCKET=your-bucket
B2_KEY_ID=your-key-id
B2_APP_KEY=your-app-key
B2_PUBLIC_URL=https://your-bucket.s3.us-west-004.backblazeb2.com

# AI
DEEPSEEK_API_KEY=sk-your-deepseek-key
GROQ_API_KEY=gsk-your-groq-key

# SENTRY (optional)
SENTRY_DSN=https://your-sentry-dsn
```

To find your DB_CONNECT_STRING:
1. Open the `tnsnames.ora` file in `~/oracle-wallet/`:
   ```bash
   cat ~/oracle-wallet/tnsnames.ora
   ```
2. Look for the entry ending in `_tp` (Transaction Processing). Copy the entire value between the parentheses.

---

## Step 12: Install Dependencies and Test

```bash
cd ~/test-platform
npm install

# Test the database connection
node -e "
const oracledb = require('oracledb');
oracledb.createPool({
  user: process.env.DB_USER || 'ADMIN',
  password: process.env.DB_PASSWORD || 'YOUR_PASSWORD',
  connectString: process.env.DB_CONNECT_STRING || 'YOUR_CONNECT_STRING',
  poolMin: 1, poolMax: 2
}).then(p => {
  console.log('Oracle connection pool created successfully!');
  return p.getConnection();
}).then(c => {
  console.log('Connected to Oracle ATP!');
  c.close();
}).catch(e => console.error('Connection failed:', e.message));
"
```

If you see `"Connected to Oracle ATP!"` — success!

---

## Step 13: Set Up nginx

```bash
sudo nano /etc/nginx/sites-available/test-platform
```

Paste:

```nginx
server {
    listen 80;
    server_name YOUR_VM_PUBLIC_IP;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    client_max_body_size 100M;
}
```

Activate it:

```bash
sudo ln -s /etc/nginx/sites-available/test-platform /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default   # remove default
sudo nginx -t                                # test config
sudo systemctl restart nginx
```

---

## Step 14: Open Ports in OCI Security List

By default, your VM only allows SSH (port 22). You need to open HTTP (port 80) and HTTPS (port 443):

1. ☰ Menu → **Networking → Virtual Cloud Networks**
2. Click your VCN (probably `test-platform-vcn`)
3. Click the **public subnet**
4. Click the **Default Security List**
5. Click **"Add Ingress Rules"**
6. Add these rules:

   | Source CIDR | IP Protocol | Source Port | Destination Port |
   |---|---|---|---|
   | `0.0.0.0/0` | TCP | All | `80` |
   | `0.0.0.0/0` | TCP | All | `443` |

7. Click **"Add Ingress Rules"**

Now you should be able to open `http://YOUR_VM_PUBLIC_IP` in a browser and see nginx.

---

## Step 15: Start the App (After Code Rewrite)

Once the code has been rewritten (Phase 2-3), start the app:

```bash
cd ~/test-platform
pm2 start server.js --name test-platform
pm2 save
pm2 startup    # follow the instructions it prints
```

---

## What's Next?

After completing these setup steps, you'll have:
- ✅ A running VM on OCI
- ✅ An Oracle ATP database ready
- ✅ Oracle Instant Client installed
- ✅ nginx reverse proxy
- ✅ The wallet uploaded and configured

The next phase is the **code rewrite** (Phase 2 + 3 from the main plan). That involves rewriting all Mongoose calls to Oracle SQL. I'll guide you through that when you're ready.

---

## Quick Reference: Important Values to Keep

| What | Value | Where to find it |
|---|---|---|
| Cloud Account Name | `_______` | Step 1 |
| VM Public IP | `_______` | Step 4, Instance details |
| ATP Admin Password | `_______` | Step 5 |
| DB Connect String | `_______` | Step 11, tnsnames.ora |
| SSH Key Location | `%USERPROFILE%\.ssh\oci-key.key` | Step 8 |
