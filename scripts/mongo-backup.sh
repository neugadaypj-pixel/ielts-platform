#!/bin/bash
# ==============================================================
# MongoDB Backup Script (runs inside the mongodb container)
# Invoked by the daily cron job on the host.
# ==============================================================
set -euo pipefail

BACKUP_DIR="/backups/$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"

echo "Starting MongoDB backup to $BACKUP_DIR..."
mongodump --uri="$MONGO_URI" --out="$BACKUP_DIR" --gzip

echo "Backup completed. Cleaning up backups older than 7 days..."
find /backups -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null

echo "Done. Current backups:"
ls -lah /backups/
