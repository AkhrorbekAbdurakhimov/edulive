#!/usr/bin/env bash
# EduLive uchun kunlik zaxira: baza + yuklangan fayllar (maktab logotiplari).
# Cron sifatida o'rnatish:
#   15 3 * * * /opt/edulive/deploy/backup.sh >> /var/log/edulive-backup.log 2>&1
set -euo pipefail

cd /opt/edulive
# POSTGRES_USER / POSTGRES_DB / BACKUP_REMOTE deploy .env dan olinadi.
set -a; [ -f /opt/edulive/.env ] && . /opt/edulive/.env; set +a

DIR=/opt/edulive/backups
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d_%H%M%S)

# ---- 1. Baza. AVVAL baza, KEYIN fayllar ------------------------------------
# Tartib ataylab shunday: ikkalasi orasida yangi rasm yuklansa, u arxivga
# tushadi-yu bazada bo'lmaydi — bu zararsiz yetim fayl. Teskari tartibda esa
# bazada rasm bor, arxivda yo'q bo'lardi va tiklashdan keyin rasm ochilmasdi.
DB_FILE="$DIR/edulive_${STAMP}.sql.gz"
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "${POSTGRES_USER:-edulive}" "${POSTGRES_DB:-edulive}" | gzip > "$DB_FILE"
echo "$(date -Is) baza:    $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

# ---- 2. Yuklangan fayllar --------------------------------------------------
FILES_FILE=""
if [ -d uploads ] && [ -n "$(ls -A uploads 2>/dev/null)" ]; then
  NEW="$DIR/edulive_uploads_${STAMP}.tar.gz"
  # gzip -n: sarlavhaga vaqt yozilmaydi, shuning uchun o'zgarmagan fayllar
  # har safar bayt-bayt bir xil arxiv beradi va quyidagi taqqoslash ishlaydi.
  tar -C /opt/edulive -cf - uploads | gzip -n > "$NEW"

  # Rasmlar kamdan-kam o'zgaradi — bir xil arxivni 14 marta saqlamaymiz.
  PREV=$(ls -t "$DIR"/edulive_uploads_*.tar.gz 2>/dev/null | sed -n 2p || true)
  if [ -n "$PREV" ] && cmp -s "$NEW" "$PREV"; then
    rm -f "$NEW"
    FILES_FILE="$PREV"
    echo "$(date -Is) fayllar: o'zgarmagan, oldingi arxiv qoldirildi ($PREV)"
  else
    FILES_FILE="$NEW"
    echo "$(date -Is) fayllar: $FILES_FILE ($(du -h "$FILES_FILE" | cut -f1))"
  fi
else
  echo "$(date -Is) fayllar: uploads bo'sh — arxiv yaratilmadi"
fi

# ---- 3. Eski nusxalarni tozalash (14 kun) ----------------------------------
find "$DIR" -name 'edulive_*.sql.gz' -mtime +14 -delete
# Fayl arxivlarida eng yangisi har doim qoladi: rasmlar 14 kundan uzoq
# o'zgarmasa, oxirgi arxiv yagona nusxa bo'ladi va uni o'chirib bo'lmaydi.
# `|| true` shart: mos fayl topilmasa `ls` nolga teng bo'lmagan kod qaytaradi
# va `pipefail` bilan birga butun skriptni to'xtatib qo'yadi.
KEEP=$(ls -t "$DIR"/edulive_uploads_*.tar.gz 2>/dev/null | head -1 || true)
if [ -n "$KEEP" ]; then
  find "$DIR" -name 'edulive_uploads_*.tar.gz' -mtime +14 ! -name "$(basename "$KEEP")" -delete
fi

# ---- 4. Serverdan tashqari nusxa -------------------------------------------
# .env da BACKUP_REMOTE belgilansa yoqiladi, masalan:
#   BACKUP_REMOTE=u123456@u123456.your-storagebox.de:edulive-backups/
# Serverning o'zi yo'qolsa yagona omon qoladigan nusxa shu — juda tavsiya etiladi.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if rsync -az --quiet "$DB_FILE" ${FILES_FILE:+"$FILES_FILE"} "$BACKUP_REMOTE"; then
    echo "$(date -Is) off-site OK: $BACKUP_REMOTE"
  else
    # Off-site yiqilsa ham lokal nusxa saqlanib qoldi — skript muvaffaqiyatsiz
    # deb hisoblanmaydi, lekin logda ko'rinib turadi.
    echo "$(date -Is) OGOHLANTIRISH: off-site nusxa yuborilmadi ($BACKUP_REMOTE)" >&2
  fi
else
  echo "$(date -Is) off-site sozlanmagan (BACKUP_REMOTE bo'sh) — faqat lokal nusxa"
fi
