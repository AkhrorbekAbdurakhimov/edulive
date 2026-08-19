# EduLive — deploy

Server **kassly bilan umumiy**. 80/443 portlarini alohida **edge proxy**
(`/opt/proxy`) egallaydi; kassly va edulive stack'lari host portini e'lon
qilmaydi, `edge` docker tarmog'i orqali proxy'ga ulanadi. Har bir mahsulotning
o'z Postgres'i, o'z volume'i va o'z backup'i bor.

```
                    ┌─────────────────────────┐
   :80 :443  ──────▶│  /opt/proxy  (Caddy)    │  TLS + domen bo'yicha ajratish
                    └───────┬─────────┬───────┘
                    kassly.uz         edulive.uz
                            │         │
                   kassly-web:80   edulive-web:80     ← host portsiz, `edge` tarmog'ida
                            │         │
                    kassly backend/db │ edulive backend/db
```

---

## 1. Bir martalik: serverni tayyorlash va edge proxy'ga o'tkazish

> Bu qadam kassly'ga ham tegadi. Ishlab turgan saytga ~10-20 soniya uzilish
> beradi. Kassly image'i **qayta yig'ilmaydi** — faqat compose va tarmoq.

### 1a. Tizimni mustahkamlash

```bash
ssh kassly 'bash -s' < deploy/server-harden.sh
```

Bajaradi: o'zgarishdan oldin backup + butunligini tekshirish → **2 GB swap**
(`vm.swappiness=10`) → `apt upgrade`. Reboot kerak bo'lsa aytadi:

```bash
ssh kassly reboot
sleep 45 && ssh kassly 'docker ps'      # konteynerlar o'zi qaytadi
```

**Nega swap.** Serverda 3.7 GB RAM va swap umuman yo'q edi. Xotira sakraganda
OOM-killer eng semiz jarayonni — ehtimol Postgres'ni — o'ldiradi. Compose
fayllarida har bir konteynerga xotira limiti qo'yilgan (db/backend 512M,
web 96M, proxy 128M): limit bo'lsa Docker aybdor konteynerni o'ldiradi,
kernel tasodifiy qurbon tanlamaydi. Ikkalasi birga ishlaydi.

### 1b. Fayllarni joylash

Repodagi yangilangan fayllarni serverga ko'chiring:

| Repodagi fayl | Serverdagi joy |
| --- | --- |
| `kassly/docker-compose.prod.yml` | `/opt/kassly/docker-compose.prod.yml` |
| `deploy/proxy/docker-compose.yml` | `/opt/proxy/docker-compose.yml` |
| `deploy/proxy/Caddyfile` | `/opt/proxy/Caddyfile` |

### 1c. Edge proxy'ga o'tkazish

```bash
ssh kassly 'bash -s' < deploy/migrate-to-edge.sh
```

Bajaradi: Caddyfile validatsiyasi → DNS tekshiruvi → `docker network create edge`
→ kassly'ni yangi compose bilan ko'tarish (80/443 bo'shaydi) → proxy'ni ishga
tushirish → `https://kassly.uz` javob berishini kutish. Javob bermasa loglarni
ko'rsatadi va orqaga qaytarish yo'lini aytadi.

**Sertifikatlar haqida.** Ilgari kassly sertifikatni o'z konteynerida saqlagan.
Endi proxy o'zi yangisini oladi — DNS to'g'ri bo'lsa bir necha soniya ichida.
`edulive.uz` DNS'i hali tayyor bo'lmasa, Caddy uni fonda qayta urinib turadi;
`kassly.uz` bundan zarar ko'rmaydi.

## 2. Bir martalik: edulive papkasi

```bash
sudo mkdir -p /opt/edulive/{uploads,backups}
# Konteyner `node` (uid 1000) sifatida ishlaydi — bind-mount shunga tegishli bo'lsin
sudo chown -R 1000:1000 /opt/edulive/uploads /opt/edulive/backups
```

`docker-compose.prod.yml` va `.env` ni `/opt/edulive/` ga ko'chiring
(`deploy/.env.example` dan nusxa oling va to'ldiring).

## 3. DNS

`edulive.uz` va `www.edulive.uz` uchun **A** yozuvi shu serverning IP'siga.
Sertifikat DNS tarqalgandan keyingina olinadi — avval `dig +short edulive.uz`
bilan tekshiring, keyin proxy'ni qayta ko'taring.

## 4. GitHub Actions

Repo: `AkhrorbekAbdurakhimov/EduLive`. `main` ga push → test → image →
GHCR → serverga deploy (`.github/workflows/deploy.yml`).

**Settings → Secrets and variables → Actions** da uchta secret:

| Secret     | Qiymat                                                     |
| ---------- | ---------------------------------------------------------- |
| `SSH_HOST` | server IP yoki hostname                                     |
| `SSH_USER` | deploy qiluvchi foydalanuvchi (docker guruhida bo'lishi shart) |
| `SSH_KEY`  | shu foydalanuvchining **private** kaliti (to'liq PEM matni)  |

`GITHUB_TOKEN` avtomatik — alohida qo'shilmaydi.

Serverda GHCR'dan tortish uchun `docker login` workflow'ning o'zi qiladi.
Birinchi deploy'dan oldin image'lar hali yo'q — avval `main` ga push qiling,
keyin `/opt/edulive` da `.env` dagi `BACKEND_IMAGE`/`WEB_IMAGE` teglari
GHCR'dagi nomlarga mos ekanini tekshiring:

```
BACKEND_IMAGE=ghcr.io/akhrorbekabdurakhimov/edulive-backend:latest
WEB_IMAGE=ghcr.io/akhrorbekabdurakhimov/edulive-web:latest
```

> GHCR paketlari sukut bo'yicha **private**. Server `docker login` bilan
> tortadi — bu workflow ichida bajariladi, qo'lda ishlatish uchun esa
> `read:packages` huquqli PAT kerak bo'ladi.

## 5. Qo'lda ishga tushirish / tekshirish

```bash
cd /opt/edulive
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f backend
```

Migratsiyalar `docker-entrypoint.sh` orqali avtomatik qo'llanadi.

Caddy konfiguratsiyasini o'zgartirgandan keyin, qayta ko'tarishdan **oldin**:

```bash
docker run --rm -v /opt/proxy/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

## 6. Telegram webhook

```bash
curl -F "url=https://edulive.uz/api/telegram/webhook" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
```

## 7. Zaxira nusxa (kunlik cron)

```bash
15 3 * * * /opt/edulive/deploy/backup.sh >> /var/log/edulive-backup.log 2>&1
```

`deploy/backup.sh` ikkita narsani oladi:

1. **Baza** — `edulive_<sana>.sql.gz`
2. **Yuklangan fayllar** — `edulive_uploads_<sana>.tar.gz` (maktab logotiplari
   va keyinchalik qo'shiladigan boshqa rasmlar)

Ikkalasi 14 kun saqlanadi. Tartib ataylab shunday: **avval baza, keyin
fayllar**. Ular orasida yangi rasm yuklansa, u arxivga tushadi-yu bazada
bo'lmaydi — zararsiz yetim fayl. Teskari tartibda bazada rasm bor, arxivda
yo'q bo'lardi va tiklashdan keyin rasm ochilmasdi.

Rasmlar kamdan-kam o'zgaradi, shuning uchun arxiv oldingisi bilan
taqqoslanadi: bir xil bo'lsa yangisi o'chiriladi va eskisi qoldiriladi.
Shu sababli fayl arxivlarida **eng yangisi 14 kundan oshsa ham o'chirilmaydi**
— aks holda o'zgarmagan rasmlar zaxirasiz qolardi.

### Tiklash

```bash
cd /opt/edulive

# 1. Baza
gunzip -c backups/edulive_<sana>.sql.gz |   docker compose -f docker-compose.prod.yml exec -T db psql -U edulive -d edulive

# 2. Fayllar (uploads/ ustiga yoziladi)
tar -xzf backups/edulive_uploads_<sana>.tar.gz -C /opt/edulive
chown -R 1000:1000 uploads     # konteyner `node` (uid 1000) sifatida yozadi
```

Fayl arxivi bazadan yangiroq bo'lishi normal — ortiqcha rasm zarar qilmaydi.

**Serverdan tashqari nusxa — hali sozlanmagan.** Hozir ikkala mahsulotning
zaxirasi ham xuddi shu diskda; server yo'qolsa ikkalasi ham ketadi.
`.env` ga bitta qator qo'shilsa yoqiladi:

```
BACKUP_REMOTE=u123456@u123456.your-storagebox.de:edulive-backups/
```

Hetzner Storage Box (~€3/oy) yoki rsync qabul qiladigan istalgan host bo'ladi.

> **Diqqat:** kassly'ning `backup.sh` si hozircha faqat bazani oladi —
> uning `uploads/` papkasi zaxiraga tushmaydi.

## 8. Orqaga qaytarish (rollback)

Har bir image commit SHA bilan ham teglanadi:

```bash
cd /opt/edulive
# .env da teglarni oldingi SHA ga o'zgartiring, masalan:
#   BACKEND_IMAGE=ghcr.io/akhrorbekabdurakhimov/edulive-backend:<sha>
docker compose -f docker-compose.prod.yml up -d
```

> Migratsiyalar oldinga yo'naltirilgan — eski image bilan yangi sxema mos
> kelmasligi mumkin. Sxemani o'zgartirgan deploy'ni qaytarishdan oldin
> `backups/` dagi oxirgi nusxani tekshiring.

---

> **Ma'lumot joyi.** 2026-yilgi o'zgarishlardan keyin oddiy shaxsiy ma'lumotlarni
> chet el bulutida saqlash mumkin. Lekin **biometrik** ma'lumot (yuz orqali
> davomat) qo'shilsa — u O'zbekistondagi serverda saqlanishi shart.
> Shuning uchun avtomatik davomatni RFID/QR karta bilan boshlash tavsiya etiladi.
