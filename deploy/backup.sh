#!/usr/bin/env bash
# EduLive uchun kunlik PostgreSQL zaxira nusxasi.
# Cron sifatida o'rnatish:
#   0 3 * * * /opt/edulive/deploy/backup.sh >> /var/log/edulive-backup.log 2>&1
set -euo pipefail

cd /opt/edulive
# POSTGRES_USER / POSTGRES_DB va boshqalar deploy .env dan olinadi.
set -a; [ -f /opt/edulive/.env ] && . /opt/edulive/.env; set +a

DIR=/opt/edulive/backups
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$DIR/edulive_${STAMP}.sql.gz"

docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER:-edulive}" "${POSTGRES_DB:-edulive}" | gzip > "$FILE"

echo "$(date -Is) backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Lokal nusxalar 14 kun saqlanadi.
find "$DIR" -name 'edulive_*.sql.gz' -mtime +14 -delete

# ---- Serverdan tashqari nusxa ----
# .env da BACKUP_REMOTE belgilansa yoqiladi, masalan:
#   BACKUP_REMOTE=u123456@u123456.your-storagebox.de:edulive-backups/
# Serverning o'zi yo'qolsa yagona omon qoladigan nusxa shu — juda tavsiya etiladi.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if rsync -az --quiet "$FILE" "$BACKUP_REMOTE"; then
    echo "$(date -Is) off-site OK: $BACKUP_REMOTE"
  else
    # Off-site yiqilsa ham lokal nusxa saqlanib qoldi — skript muvaffaqiyatsiz
    # deb hisoblanmaydi, lekin logda ko'rinib turadi.
    echo "$(date -Is) OGOHLANTIRISH: off-site nusxa yuborilmadi ($BACKUP_REMOTE)" >&2
  fi
else
  echo "$(date -Is) off-site sozlanmagan (BACKUP_REMOTE bo'sh) — faqat lokal nusxa"
fi
