#!/bin/bash
# Backup Numa data files (sessions.json, analytics.json)
# Usage: ./scripts/backup-data.sh
# Can be scheduled via cron: 0 */6 * * * /Users/steven/Medium/numerologie-chatbot/scripts/backup-data.sh

DATA_DIR="/Users/steven/Medium/numerologie-chatbot/data"
BACKUP_DIR="/Users/steven/Medium/numerologie-chatbot/data/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
MAX_BACKUPS=30

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup each data file
for file in sessions.json analytics.json; do
  src="$DATA_DIR/$file"
  if [ -f "$src" ]; then
    cp "$src" "$BACKUP_DIR/${file%.json}_${TIMESTAMP}.json"
    echo "[backup] $file -> ${file%.json}_${TIMESTAMP}.json"
  else
    echo "[backup] SKIP $file (not found)"
  fi
done

# Rotate: keep only last MAX_BACKUPS per file type
for prefix in sessions analytics; do
  count=$(ls -1 "$BACKUP_DIR/${prefix}_"*.json 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt "$MAX_BACKUPS" ]; then
    to_delete=$((count - MAX_BACKUPS))
    ls -1t "$BACKUP_DIR/${prefix}_"*.json | tail -n "$to_delete" | xargs rm -f
    echo "[backup] Rotated $to_delete old ${prefix} backups"
  fi
done

echo "[backup] Done — $(date)"
