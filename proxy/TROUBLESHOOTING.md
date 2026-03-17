# Устранение ошибки Gemini 400 "API Key not found"

## Причины

1. **Утёкший ключ** — Google блокирует ключи, попавшие в публичные репозитории. Если ключ был в DEPLOY.md или другом файле в GitHub — создайте новый.
2. **pm2 кэширует старый env** — при первом запуске pm2 мог сохранить переменные. Нужен полный перезапуск.
3. **Ключ истёк или отозван** — создайте новый на [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## Решение: полный перезапуск pm2

```bash
ssh root@72.56.125.199
cd /opt/gemini-proxy

# 1. Проверить .env
cat .env
# Должно быть: GEMINI_API_KEY=AIzaSy... (без кавычек, без пробелов)

# 2. Удалить процесс pm2 (сбрасывает кэш env)
pm2 delete gemini-proxy

# 3. Запустить заново (dotenv загрузит .env)
pm2 start server.js --name gemini-proxy

# 4. Сохранить для автозапуска
pm2 save
pm2 startup
```

## Проверка

1. **Диагностика:** https://gemini-proxy.mooo.com/debug-key  
   - keyLoaded: true, keyLength: 39, keyPrefix: "AIzaSy..."

2. **Тест ключа:** https://gemini-proxy.mooo.com/test-gemini  
   - Должен вернуть `{"ok":true,"message":"Ключ работает"}`  
   - Если 400 — ключ недействителен, создайте новый

3. **Плагин в Figma** — «Проверить UX»

## Важно

- Никогда не коммитьте реальные ключи в Git
- DEPLOY.md и .env.example содержат только плейсхолдеры
