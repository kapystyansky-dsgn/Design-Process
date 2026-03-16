# UX Audit — Gemini API Proxy

Прокси-сервер для обхода гео-блокировки Gemini API.
Устанавливается на VPS за пределами РФ (Hetzner, DigitalOcean, и т.д.).

## Быстрый старт

```bash
npm install
npm start
```

Сервер запустится на порту 3000.

## Деплой на VPS

```bash
# 1. Установить Node.js 18+ на сервере
# 2. Скопировать папку proxy на сервер
scp -r proxy/ user@your-server:/opt/gemini-proxy/

# 3. На сервере:
cd /opt/gemini-proxy
npm install
npm start

# Для фонового запуска:
# npm install -g pm2
# pm2 start server.js --name gemini-proxy
```

## HTTPS (обязательно для Figma)

Figma-плагины работают в iframe с origin `https://www.figma.com`,
поэтому прокси должен работать по HTTPS.

Самый простой способ — Caddy как reverse proxy:

```
# /etc/caddy/Caddyfile
your-domain.com {
    reverse_proxy localhost:3000
}
```

Caddy автоматически получит SSL-сертификат от Let's Encrypt.

## Endpoints

- `GET /health` — проверка работоспособности
- `POST /v1/generate` — проксирование запроса к Gemini

### POST /v1/generate

```json
{
  "apiKey": "AIza...",
  "model": "gemini-2.5-flash",
  "contents": [...],
  "generationConfig": {...}
}
```

Ответ — прямой ответ от Gemini API.

## Безопасность

- Rate limit: 30 запросов/минуту
- Допустимые модели: gemini-2.5-flash, gemini-2.0-flash, gemini-2.0-flash-lite
- API-ключ передаётся в теле запроса (не в URL), не логируется
