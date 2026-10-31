#!/usr/bin/env bash
# Automated PostgreSQL backup → S3
# Run via cron: 0 2 * * * /path/to/backup-postgres.sh
set -euo pipefail

BACKUP_DIR="/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="sitedock_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

mkdir -p "${BACKUP_DIR}"

# 1. Database dump
pg_dump -h "${POSTGRES_HOST:-localhost}" \
        -U "${POSTGRES_USER:-sitedock}" \
        -d "${POSTGRES_DB:-sitedock}" \
        --no-password \
        --format=custom \
        --compress=9 \
        > "${BACKUP_PATH}"

# 2. Verify backup integrity
if ! gzip -t "${BACKUP_PATH}"; then
  echo "ERROR: The backup file is corrupt" >&2
  exit 1
fi

# 3. Upload to S3 (if configured)
if [ -n "${S3_BUCKET:-}" ]; then
  aws s3 cp "${BACKUP_PATH}" "s3://${S3_BUCKET}/backups/${BACKUP_FILE}" \
    --region "${S3_REGION:-us-east-1}"
fi

# 4. Clean up old local backups
find "${BACKUP_DIR}" -name "sitedock_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

# 5. Clean up old remote backups (S3)
if [ -n "${S3_BUCKET:-}" ]; then
  aws s3api list-object-versions \
    --bucket "${S3_BUCKET}" \
    --prefix "backups/" \
    --region "${S3_REGION:-us-east-1}" \
    --query "Versions[?LastModified<=\`$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d)\`].{Key:Key,VersionId:VersionId}" \
    --output text | while read -r key version; do
    aws s3api delete-object --bucket "${S3_BUCKET}" --key "${key}" --version-id "${version}" --region "${S3_REGION:-us-east-1}" || true
  done
fi

echo "Backup completed: ${BACKUP_PATH}"
