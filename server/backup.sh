#!/bin/bash
# Simple script to backup the Space Rally server data
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
curl -s -L -o "$BACKUP_DIR/backup_$TIMESTAMP.sqlite" http://localhost:8787/api/backup
echo "Backup saved to $BACKUP_DIR/backup_$TIMESTAMP.sqlite"
