#!/usr/bin/env bash
# Kassly'ni umumiy edge proxy'ga o'tkazish — BIR MARTALIK, root sifatida.
#   ssh kassly 'bash -s' < deploy/migrate-to-edge.sh
#
# SHART: /opt/kassly/docker-compose.prod.yml va /opt/proxy/{docker-compose.yml,
# Caddyfile} allaqachon yangilangan bo'lishi kerak (repodagi versiyalar).
#
# Uzilish: ~10-20 soniya. Idempotent — qayta ishga tushirsa bo'ladi.
set -euo pipefail

echo "════ 0/4  Tekshiruvlar ════"
[ -f /opt/proxy/docker-compose.yml ] || { echo "! /opt/proxy/docker-compose.yml yo'q"; exit 1; }
[ -f /opt/proxy/Caddyfile ]          || { echo "! /opt/proxy/Caddyfile yo'q"; exit 1; }
grep -q 'edge' /opt/kassly/docker-compose.prod.yml || {
  echo "! /opt/kassly/docker-compose.prod.yml hali eski (edge tarmog'i yo'q)"; exit 1; }

# Caddy konfiguratsiyasi buzuq bo'lsa ikkala domen ham o'chadi — oldindan tekshiramiz.
echo "— Caddyfile validatsiyasi:"
docker run --rm -v /opt/proxy/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -1

SERVER_IP=$(curl -s --max-time 8 https://api.ipify.org || echo "?")
for d in kassly.uz edulive.uz; do
  R=$(getent hosts "$d" | awk '{print $1}' | head -1 || true)
  if [ "$R" = "$SERVER_IP" ]; then echo "✓ DNS $d → $R"
  else echo "⚠ DNS $d → ${R:-topilmadi} (server: $SERVER_IP) — sertifikat olinmaydi, Caddy qayta urinib turadi"; fi
done

echo
echo "════ 1/4  Umumiy tarmoq ════"
docker network inspect edge >/dev/null 2>&1 && echo "✓ edge allaqachon bor" \
  || { docker network create edge >/dev/null; echo "✓ edge yaratildi"; }

echo
echo "════ 2/4  Kassly'ni yangi compose bilan ko'tarish (80/443 bo'shaydi) ════"
cd /opt/kassly
docker compose -f docker-compose.prod.yml up -d --remove-orphans < /dev/null

echo
echo "════ 3/4  Edge proxy ════"
cd /opt/proxy
docker compose up -d < /dev/null

echo
echo "════ 4/4  Tekshirish ════"
# Sertifikat olinishi bir necha soniya — 60 soniyagacha kutamiz.
# curl ba'zan bir nechta qator chiqaradi (masalan IPv4/IPv6) — oxirgisini olamiz
# va aynan 200 ni kutamiz. "000 emas" tekshiruvi yetarli emas edi: ulanish
# xatosida ham qiymat "000" dan farq qilib qolib, sikl darhol uzilardi.
for i in $(seq 1 20); do
  # curl ba'zan kodni bir necha marta chiqaradi — oxirgi 3 belgini olamiz.
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://kassly.uz/ 2>/dev/null | tail -c 3)
  [ "$CODE" = "200" ] && break
  sleep 3
done
echo "kassly.uz HTTP kodi: ${CODE:-000} (200 kutilgan)"
echo "backend sog'ligi:    $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://kassly.uz/health || echo 000)"
echo
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
if [ "${CODE:-000}" != "200" ]; then
  echo "✗ kassly.uz javob bermayapti. Loglar:"
  docker compose -f /opt/proxy/docker-compose.yml logs --tail=40 proxy
  echo
  echo "Orqaga qaytarish: /opt/kassly/docker-compose.prod.yml dagi eski"
  echo "ports (80/443) ni tiklab, 'docker compose up -d' qiling."
  exit 1
fi
echo "✓ tayyor — endi /opt/edulive ni ko'tarish mumkin"
