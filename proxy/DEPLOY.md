# Деплой обновлённого proxy на gemini-proxy.mooo.com

## Вариант 1: Через SCP (с вашего компьютера)

### 1. Узнайте IP сервера

- **Вариант A:** Зайдите в панель хостинга (Cloud NL или где создавали сервер) и посмотрите IP.
- **Вариант B:** В cmd выполните `ping gemini-proxy.mooo.com` — в ответе будет IP.

### 2. Скопируйте файлы

Откройте **cmd** или **PowerShell** в папке `Check UX-design/proxy`:

```bash
# Замените 123.45.67.89 на IP вашего сервера
scp server.js mcp-server.js package.json root@123.45.67.89:/opt/gemini-proxy/
```

Введите пароль root, когда попросит.

### 3. Подключитесь по SSH и обновите

```bash
ssh root@123.45.67.89
```

На сервере выполните:

```bash
cd /opt/gemini-proxy

# Установить новые зависимости (dotenv, MCP SDK, zod)
npm install

# Создать .env если ещё нет (или отредактировать)
nano .env
```

В .env должно быть:
```
GEMINI_API_KEY=AIzaSyDEmqOkW1bOyVOTZ0gai4lgdWN1BFIQpuM
FIGMA_ACCESS_TOKEN=ваш_токен_если_есть
PORT=3000
```

Сохраните: Ctrl+O, Enter, Ctrl+X.

```bash
# Перезапустить proxy
pm2 restart gemini-proxy

# Проверить
pm2 logs gemini-proxy
```

### 4. Проверка

Откройте в браузере: https://gemini-proxy.mooo.com/health

Должен вернуть: `{"status":"ok","gemini":true,"figma":true,...}`

---

## Вариант 2: Всё вручную на сервере

Если SCP не работает (например, Windows без OpenSSH):

1. Подключитесь: `ssh root@ВАШ_IP`
2. Откройте `server.js`: `nano /opt/gemini-proxy/server.js`
3. Скопируйте содержимое вашего локального `server.js` (из папки proxy) и вставьте, заменив всё
4. То же для `mcp-server.js` — создайте файл: `nano /opt/gemini-proxy/mcp-server.js` и вставьте содержимое
5. Обновите `package.json` — добавьте в dependencies: `"dotenv"`, `"@modelcontextprotocol/sdk"`, `"zod"`
6. Выполните: `cd /opt/gemini-proxy && npm install && pm2 restart gemini-proxy`

---

## Важно: pm2 и переменные окружения

Сейчас pm2, скорее всего, запускает так:
```bash
GEMINI_API_KEY="..." pm2 start server.js --name gemini-proxy
```

После обновления proxy использует **.env** файл. Два варианта:

**A) Оставить как есть** — переменные в команде pm2. Тогда .env не нужен.

**B) Использовать .env** — создайте `/opt/gemini-proxy/.env`:
```
GEMINI_API_KEY=AIzaSy...
FIGMA_ACCESS_TOKEN=figd_...
PORT=3000
```

И перезапустите:
```bash
pm2 delete gemini-proxy
cd /opt/gemini-proxy
pm2 start server.js --name gemini-proxy
pm2 save
```

---

## Полезные команды

```bash
pm2 status              # статус
pm2 logs gemini-proxy   # логи
pm2 restart gemini-proxy  # перезапуск
```
