# Flow: Design Process

Целевая архитектура плагина Design Process. Пользователь открывает плагин → три функции.

## Функции

1. **Оформить файл** — создание структуры страниц (МБ, ИБ, Метаданные, Cover), добавление компонента Cover на страницу Cover, компонентов метаданных на страницу Метаданные. Источник компонентов — Figma Tools.
2. **Проверить UX** — UX-аудит выделенного флоу через Gemini: отправка DESIGN_JSON (структура экранов, текстов, действий), получение отчёта (Cognitive Walkthrough, Multi-Role Analysis, Nielsen Heuristics, Usability Hypotheses, ICE).
3. **Проверить дизайн на соответствие дизайн-системе** — сверка макетов с компонентами библиотеки (в разработке).

## Ссылки

- **Tools** (компоненты для Оформить файл): `https://www.figma.com/design/zh8JGwSZKLdlUG2F3lJsNQ/Tools`
- **Промпт UX-аудита:** [UX_REVIEW_PROMPT.md](UX_REVIEW_PROMPT.md)
