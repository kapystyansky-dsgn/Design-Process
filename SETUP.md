# Настройка Design Process

## 1. Proxy-сервер (backend)

### Установка зависимостей
```bash
cd Check UX-design/proxy
npm install
```

### Настройка переменных окружения

Откройте файл `proxy/.env` и вставьте свои ключи:

| Переменная | Где взять | Пример |
|------------|-----------|--------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) → Create API key | `AIzaSy...` |
| `FIGMA_ACCESS_TOKEN` | Figma → Settings → Personal access tokens → Generate new token | `figd_...` |
| `PORT` | По умолчанию 3000 | `3000` |

### Запуск
```bash
cd proxy
npm start
```

Сервер будет доступен на `http://localhost:3000`.

---

## 2. Плагин Figma (UI)

### URL proxy

В файле `ui.html` найдите блок:
```javascript
var PROXY_URL = 'https://gemini-proxy.mooo.com';
```

Замените на:
- **Локальная разработка:** `http://localhost:3000` (нужен туннель [ngrok](https://ngrok.com) или аналог, т.к. Figma не обращается к localhost напрямую)
- **Продакшен:** URL вашего развёрнутого proxy (например `https://ваш-домен.com`)

---

## 3. MCP (Cursor)

Proxy предоставляет MCP-сервер с инструментами Figma для Cursor.

### Инструменты

- **get_file_structure** — структура из «База знаний» (для «Создать структуру файла»)
- **get_metadata_structure** — структура из «Tools» (для «Добавить метаданные»)

### Подключение в Cursor

Добавьте в `~/.cursor/mcp.json` (или Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "Design Process": {
      "url": "https://gemini-proxy.mooo.com/mcp"
    }
  }
}
```

Для локального proxy:
```json
"Design Process": {
  "url": "http://localhost:3000/mcp"
}
```

Перезапустите Cursor после изменения mcp.json.

---

## 4. Проверка

1. Запустите proxy: `cd proxy && npm start`
2. Откройте в браузере: `http://localhost:3000/health`
3. Должен вернуться JSON: `{ "status": "ok", "gemini": true, "figma": true }`

---

## Где взять ключи

- **Gemini API:** https://aistudio.google.com/apikey → Create API key
- **Figma Token:** Figma → Settings (иконка профиля) → Personal access tokens → Generate new token
