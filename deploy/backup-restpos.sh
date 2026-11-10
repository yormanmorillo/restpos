#!/usr/bin/env bash
set -euo pipefail

CID="$(sudo docker ps -q --filter "label=dokploy.application=restpos" --filter "label=dokploy.service=api" | head -n1)"
if [[ -z "${CID}" ]]; then
  echo "No se encontró el contenedor del API." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="/data/restpos-backup-${STAMP}.db"
UPLOADS_TMP="/data/restpos-uploads-${STAMP}.tar.gz"
HOST_DIR="/home/ubuntu/restpos-backups"
mkdir -p "${HOST_DIR}"
chmod 700 "${HOST_DIR}"

sudo docker exec "${CID}" node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/data/restpos.db'); db.exec(\"VACUUM INTO '${TMP}'\"); db.close();"
sudo docker cp "${CID}:${TMP}" "${HOST_DIR}/restpos-${STAMP}.db"
sudo docker exec "${CID}" rm -f "${TMP}"

sudo docker exec "${CID}" sh -c "mkdir -p /data/uploads && tar -czf '${UPLOADS_TMP}' -C /data uploads"
sudo docker cp "${CID}:${UPLOADS_TMP}" "${HOST_DIR}/restpos-uploads-${STAMP}.tar.gz"
sudo docker exec "${CID}" rm -f "${UPLOADS_TMP}"

sudo gzip -f "${HOST_DIR}/restpos-${STAMP}.db"
sudo chmod 600 "${HOST_DIR}/restpos-${STAMP}.db.gz" "${HOST_DIR}/restpos-uploads-${STAMP}.tar.gz"
find "${HOST_DIR}" -type f -name 'restpos-*.db.gz' -mtime +14 -delete
find "${HOST_DIR}" -type f -name 'restpos-uploads-*.tar.gz' -mtime +14 -delete
echo "[$(date -u +%FT%TZ)] backup OK: ${HOST_DIR}/restpos-${STAMP}.db.gz + uploads"
