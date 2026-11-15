#!/usr/bin/env bash
set -euo pipefail

# Automated PostgreSQL + uploaded documents backup script for INSA Racing Achats.
# Recommended cron entry (daily at 03:00):
#   0 3 * * * /home/ubuntu/insa-racing-budget/deploy/backup.sh >> /var/log/insa-achats-backup.log 2>&1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

read_env_var() {
  local key="$1"
  local fallback="$2"
  if [ -f .env ]; then
    local val
    val="$(grep -E "^${key}=" .env | tail -n 1 | cut -d= -f2- | tr -d '\r')"
    val="${val#\"}"
    val="${val%\"}"
    val="${val#\'}"
    val="${val%\'}"
    if [ -n "${val}" ]; then
      printf '%s' "${val}"
      return 0
    fi
  fi
  printf '%s' "${fallback}"
}

BACKUP_DIR="${BACKUP_DIR:-${REPO_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
POSTGRES_USER="$(read_env_var POSTGRES_USER insa_achats)"
POSTGRES_DB="$(read_env_var POSTGRES_DB insa_achats)"
STAMP="$(date +%F_%H%M%S)"

mkdir -p "${BACKUP_DIR}"

echo "[backup] Starting backup at ${STAMP}..."

DB_OUT="${BACKUP_DIR}/db_${STAMP}.sql.gz"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${DB_OUT}"
echo "[backup] Database saved to ${DB_OUT}"

APP_CONTAINER="$(docker compose ps -q app)"
if [ -z "${APP_CONTAINER}" ]; then
  echo "[backup] ERROR: app container is not running; cannot inspect upload volume." >&2
  exit 1
fi

UPLOAD_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/uploads"}}{{.Name}}{{end}}{{end}}' "${APP_CONTAINER}")"
if [ -z "${UPLOAD_VOLUME}" ]; then
  echo "[backup] ERROR: /data/uploads volume mount not found." >&2
  exit 1
fi

UPLOADS_OUT="${BACKUP_DIR}/uploads_${STAMP}.tar.gz"
docker run --rm -v "${UPLOAD_VOLUME}:/data:ro" -v "${BACKUP_DIR}:/backup" alpine \
  tar czf "/backup/uploads_${STAMP}.tar.gz" -C /data .
echo "[backup] Uploads saved to ${UPLOADS_OUT}"

find "${BACKUP_DIR}" -type f \( -name "db_*.sql.gz" -o -name "uploads_*.tar.gz" \) -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] Completed cleanly (retention: ${RETENTION_DAYS} days)."
