# Пошаговая настройка прокси-сервера

## Шаг 0. Создать сервер

1. Выберите **Cloud NL-15** (690 ₽/мес)
2. ОС: **Ubuntu 22.04** или **Ubuntu 24.04**
3. Включите **Публичный IP**
4. Задайте **пароль root** (запишите его)
5. После создания скопируйте **IP-адрес** сервера

---

## Шаг 1. Подключиться к серверу

Откройте **cmd** (не PowerShell) на вашем компьютере:

```
ssh root@ВАШ_IP
```

При первом подключении напишет "Are you sure...?" — введите `yes`.
Затем введите пароль root.

> Если ssh не работает — скачайте [PuTTY](https://www.putty.org/),
> введите IP, порт 22, нажмите Open, логин: root, пароль: ваш пароль.

---

## Шаг 2. Установить всё одной командой

Скопируйте и вставьте в терминал сервера **всю команду целиком**:

```bash
curl -fsSL https://raw.githubusercontent.com/nodesource/distributions/main/deb/setup_18.x | bash - && apt-get install -y nodejs && npm install -g pm2 && apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && apt-get update && apt-get install -y caddy
```

Дождитесь окончания (1-2 минуты). Проверьте:

```bash
node -v
caddy version
```

Должно показать версии Node.js и Caddy.

---

## Шаг 3. Создать папку и файлы прокси

```bash
mkdir -p /opt/gemini-proxy && cd /opt/gemini-proxy
```

Создайте package.json:

```bash
cat > package.json << 'EOF'
{
  "name": "ux-audit-gemini-proxy",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.4.0"
  }
}
EOF
```

Создайте server.js:

```bash
cat > server.js << 'SERVEREOF'
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const ALLOWED_MODELS = ['gemini-2.5-flash','gemini-2.0-flash','gemini-2.0-flash-lite'];

app.use(cors({ origin: '*', methods: ['POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '20mb' }));
app.use('/v1/', rateLimit({ windowMs: 60000, max: 30, message: { error: 'Too many requests' } }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', hasKey: !!GEMINI_API_KEY, models: ALLOWED_MODELS });
});

app.post('/v1/generate', async (req, res) => {
  try {
    const { contents, generationConfig, model } = req.body;
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    if (!contents || !Array.isArray(contents)) return res.status(400).json({ error: 'Invalid contents' });
    const m = (model && ALLOWED_MODELS.includes(model)) ? model : ALLOWED_MODELS[0];
    const resp = await fetch(GEMINI_BASE + m + ':generateContent?key=' + GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    });
    const data = await resp.text();
    res.status(resp.status).set('Content-Type', 'application/json').send(data);
  } catch (err) {
    res.status(502).json({ error: 'Proxy: ' + (err.message || String(err)) });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log('Proxy on port ' + PORT));
SERVEREOF
```

Установите зависимости:

```bash
npm install
```

---

## Шаг 4. Задать API-ключ и запустить

Замените `AIzaSy...ваш-ключ` на реальный ключ из https://aistudio.google.com/apikey:

```bash
GEMINI_API_KEY="AIzaSy...ваш-ключ" pm2 start server.js --name gemini-proxy
```

Проверьте, что работает:

```bash
curl http://localhost:3000/health
```

Должен вернуть: `{"status":"ok","hasKey":true,...}`

Сохраните конфигурацию pm2 (чтобы сервер запускался после перезагрузки):

```bash
pm2 save
pm2 startup
```

---

## Шаг 5. Настроить HTTPS

Figma требует HTTPS. Два варианта:

### Вариант A: Есть свой домен

Направьте домен (например, `gemini.yourdomain.com`) на IP сервера через A-запись в DNS.

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
gemini.yourdomain.com {
    reverse_proxy localhost:3000
}
EOF

systemctl restart caddy
```

Caddy автоматически получит SSL-сертификат. Ваш proxy URL:
```
https://gemini.yourdomain.com
```

### Вариант B: Нет домена — используем IP + самоподписанный сертификат

Этот вариант **не сработает** с Figma, потому что iframe не принимает самоподписанные сертификаты.

**Решение без домена**: используйте бесплатный домен:
1. Зайдите на https://freedns.afraid.org/ → Register
2. Создайте субдомен (например, `gemini-proxy.mooo.com`)
3. Укажите IP вашего сервера
4. Используйте вариант A с этим доменом

---

## Шаг 6. Проверить

В браузере откройте:

```
https://ваш-домен/health
```

Должен показать JSON: `{"status":"ok","hasKey":true,...}`

---

## Шаг 7. Вставить URL в плагин

На вашем рабочем компьютере в файле:
`C:\Users\Mikhail\Desktop\Check design\Check UX-design\ui.html`

Найдите строку:
```
var TEAM_PROXY_URL = 'https://PROXY_URL_PLACEHOLDER';
```

Замените на:
```
var TEAM_PROXY_URL = 'https://ваш-домен';
```

Перекомпилируйте:
```
cd "C:\Users\Mikhail\Desktop\Check design\Check UX-design"
npx tsc -p tsconfig.json
```

Готово! Плагин работает для всей команды.

---

## Полезные команды на сервере

```bash
pm2 logs gemini-proxy    # смотреть логи
pm2 restart gemini-proxy  # перезапустить
pm2 stop gemini-proxy     # остановить
pm2 status                # статус всех процессов
```

## Обновить API-ключ

```bash
pm2 delete gemini-proxy
GEMINI_API_KEY="новый-ключ" pm2 start server.js --name gemini-proxy
pm2 save
```
