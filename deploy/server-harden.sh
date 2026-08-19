#!/usr/bin/env bash
# Serverni ikkinchi mahsulotga tayyorlash — BIR MARTALIK, root sifatida.
#   ssh kassly 'bash -s' < deploy/server-harden.sh
#
# Idempotent: qayta ishga tushirsa bo'ladi.
# Oxirida reboot KERAK BO'LISHI mumkin — skript o'zi reboot qilmaydi, aytadi.
set -euo pipefail

echo "════ 1/3  Bazani zaxiralash (o'zgarishdan oldin) ════"
if [ -x /opt/kassly/deploy/backup.sh ]; then
  # docker compose exec stdin'ni yeydi — shuning uchun </dev/null.
  /opt/kassly/deploy/backup.sh < /dev/null
  LATEST=$(ls -t /opt/kassly/backups/kassly_*.sql.gz | head -1)
  gzip -t "$LATEST" && echo "✓ backup butun: $LATEST"
else
  echo "! /opt/kassly/deploy/backup.sh topilmadi — davom etilmaydi"; exit 1
fi

echo
echo "════ 2/3  Swap (2 GB) ════"
# Nega kerak: 3.7 GB RAM va swap yo'q. Xotira sakraganda OOM-killer darhol
# ishga tushadi va eng semiz jarayonni — ehtimol Postgres'ni — o'ldiradi.
# Swap bu sakrashni yumshatadi; konteyner limitlari bilan birga ishlaydi.
if swapon --show | grep -q .; then
  echo "✓ swap allaqachon bor:"; swapon --show
else
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Baza serveri uchun swap faqat "xavfsizlik yostig'i" bo'lsin, kundalik
  # ishlatiladigan joy emas — shuning uchun swappiness past.
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "✓ swap yoqildi:"; swapon --show
fi

echo
echo "════ 3/3  Tizim yangilanishlari ════"
export DEBIAN_FRONTEND=noninteractive
# needrestart yangilangan xizmatlarni o'zi qayta ishga tushirmasin — Docker
# kutilmaganda restart bo'lsa konteynerlar o'rtasida uzilish bo'ladi.
# Baribir oxirida reboot qilinadi, shuning uchun 'l' (faqat ro'yxat).
export NEEDRESTART_MODE=l
apt-get update -qq
echo "— yangilanadigan paketlar:"
apt list --upgradable 2>/dev/null | tail -n +2 | wc -l
# --force-confold: serverdagi mavjud config fayllar saqlanadi, savol berilmaydi.
apt-get -y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef upgrade
apt-get -y autoremove

echo
echo "════ Natija ════"
free -h
echo
if [ -f /var/run/reboot-required ]; then
  echo "⚠  REBOOT KERAK. Konteynerlar 'unless-stopped' — o'zi qaytadi."
  echo "   Bajaring:  ssh kassly reboot"
  echo "   Keyin:     ssh kassly 'docker ps'"
else
  echo "✓ reboot shart emas"
fi
