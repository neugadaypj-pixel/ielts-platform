# Performance Optimization for 1GB RAM Oracle Server

## Current Situation
- Oracle Cloud Free Tier: 1GB RAM
- Running: Node.js app + Oracle Database + Nginx
- Potential issues: Memory pressure, slow response times

## Optimizations to Implement

### 1. PM2 Configuration (Reduce Memory Usage)

**Current:** Probably running in cluster mode or default settings
**Optimize:** Single instance with memory limits

```bash
# Stop current instance
pm2 delete server-oracle

# Start with optimized settings
pm2 start server-oracle.js \
  --name server-oracle \
  --max-memory-restart 400M \
  --node-args="--max-old-space-size=384" \
  --time

# Save configuration
pm2 save
pm2 startup
```

**What this does:**
- Limits Node.js heap to 384MB (leaves room for OS)
- Auto-restarts if memory exceeds 400MB
- Prevents memory leaks from crashing server

### 2. Node.js Memory Optimization

Add to `server-oracle.js` startup:

```javascript
// At the very top of server-oracle.js
if (process.env.NODE_ENV === 'production') {
    // Reduce V8 memory limits for 1GB server
    require('v8').setFlagsFromString('--max_old_space_size=384');
    
    // Enable aggressive garbage collection
    if (global.gc) {
        setInterval(() => {
            global.gc();
        }, 60000); // Every minute
    }
}
```

### 3. Oracle Database Connection Pool

**Current settings** (in server-oracle.js):
```javascript
// Check current pool size - likely too high for 1GB RAM
```

**Optimize** - Reduce connection pool:

```javascript
// In database/connection.js or wherever pool is configured
const pool = oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 1,          // Reduced from default 2
    poolMax: 4,          // Reduced from default 10
    poolIncrement: 1,    // Grow slowly
    poolTimeout: 60,     // Close idle connections after 60s
    queueTimeout: 5000   // Don't wait forever for connections
});
```

### 4. Nginx Optimization

Edit `/etc/nginx/nginx.conf`:

```nginx
# Reduce worker processes for 1GB RAM
worker_processes 1;  # Instead of auto

# Optimize worker connections
events {
    worker_connections 512;  # Reduced from 1024
    use epoll;
}

http {
    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript application/xml+rss;
    
    # Buffer settings for low memory
    client_body_buffer_size 128k;
    client_max_body_size 50m;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 8k;
    
    # Timeouts
    client_body_timeout 12;
    client_header_timeout 12;
    keepalive_timeout 15;
    send_timeout 10;
    
    # Cache
    open_file_cache max=1000 inactive=20s;
    open_file_cache_valid 30s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;
}
```

### 5. Enable Swap (Emergency Memory)

```bash
# Check if swap exists
sudo swapon --show

# If no swap, create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Optimize swappiness (use swap less aggressively)
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

### 6. Session Store Optimization

**Current:** Sessions stored in Oracle DB
**Issue:** Each session query uses memory

**Optimize:** Add session cleanup

```javascript
// In server-oracle.js, add automatic session cleanup
cron.schedule('0 */6 * * *', async () => {
    // Clean up expired sessions every 6 hours
    try {
        await execute(`DELETE FROM sessions WHERE expires < SYSTIMESTAMP`);
        logger.info('Cleaned up expired sessions');
    } catch (err) {
        logger.error('Session cleanup error', { error: err.message });
    }
});
```

### 7. Cache Optimization

**Current:** NodeCache with default settings
**Optimize:** Reduce cache size

```javascript
// In server-oracle.js, update cache configuration
const cache = new NodeCache({
    stdTTL: 300,           // Keep at 5 minutes
    checkperiod: 60,       // Keep at 1 minute
    maxKeys: 500,          // Reduced from 1000
    useClones: false,      // Don't clone (saves memory)
    deleteOnExpire: true   // Auto-delete expired
});
```

### 8. Monitoring Setup

Install monitoring to catch issues:

```bash
# Install htop for better monitoring
sudo apt install htop

# Monitor in real-time
htop

# Or use PM2 monitoring
pm2 monit
```

### 9. Log Rotation

Prevent logs from filling disk:

```bash
# Install PM2 log rotation
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### 10. Disable Unnecessary Services

```bash
# Check what's running
sudo systemctl list-units --type=service --state=running

# Disable unnecessary services (examples):
sudo systemctl disable snapd
sudo systemctl stop snapd
```

## Implementation Order

1. **Immediate (Do First):**
   - Enable swap
   - Optimize PM2 settings
   - Reduce Oracle connection pool

2. **Medium Priority:**
   - Nginx optimization
   - Cache optimization
   - Session cleanup

3. **Long Term:**
   - Monitoring setup
   - Log rotation
   - Code-level optimizations

## Expected Results

**Before:**
- Memory usage: 800-950MB (90-95%)
- Slow response times under load
- Occasional crashes

**After:**
- Memory usage: 500-700MB (50-70%)
- Faster response times
- Stable under normal load
- Swap handles spikes

## Monitoring Commands

```bash
# Check memory usage
free -h

# Check swap usage
swapon --show

# Check PM2 memory
pm2 list

# Check process memory
ps aux --sort=-%mem | head -10

# Check Oracle DB memory
ps aux | grep oracle

# Real-time monitoring
htop
```

## Warning Signs

Watch for:
- Memory usage > 90% consistently
- Swap usage > 1GB
- PM2 restart count increasing
- Slow database queries

## Alternative: Upgrade RAM

If optimizations aren't enough:
- Oracle Cloud allows upgrading to 2GB or 4GB
- May require moving to paid tier
- Cost: ~$5-10/month for 2GB

## Questions to Answer

1. How many concurrent users do you expect?
2. What's your peak traffic time?
3. Are you seeing specific slow pages?
4. Do you need all features running simultaneously?

These will help determine if 1GB is sufficient or if upgrade is needed.
