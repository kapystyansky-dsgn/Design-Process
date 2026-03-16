# Design Process (Figma Plugin)

Плагин для Figma с тремя функциями:

1. **Оформить файл** — создание структуры страниц (МБ, ИБ, Метаданные, Cover) и добавление компонентов из Tools.
2. **Проверить UX** — UX-аудит выделенного флоу через Gemini: Cognitive Walkthrough, Multi-Role Analysis, Nielsen Heuristics, Usability Hypotheses (ICE).
3. **Проверить дизайн на соответствие дизайн-системе** — в разработке.

Промпт для UX-аудита — `docs/UX_REVIEW_PROMPT.md`. Реализация в `ui.html` (buildPromptForDesign).

## Запуск

```bash
npm install
npm run build
```

В Figma: Plugins → Development → Import plugin from manifest → выбрать папку плагина (нужен собранный `code.js` из `code.ts`).

Для автоматической пересборки при изменениях: `npm run watch`.

## Прокси для Gemini

Если Gemini API недоступен из вашего региона, в папке `proxy/` лежит простой прокси-сервер. Инструкции — в `proxy/README.md` и `proxy/SETUP.md`.

## Структура

- `code.ts` — логика плагина (Figma API): локальный DS-чек, сборка DESIGN_JSON, обработка сообщений от UI.
- `ui.html` — интерфейс и вызовы AI (Gemini/Perplexity), один промпт — `buildPromptForDesign`.
- `manifest.json` — конфигурация плагина (в Figma отображается как «UX Flow Audit Agent»).
- `docs/UX_REVIEW_PROMPT.md` — референсный текст промпта для UX-ревью (JTBD, flow, доступность).
