# RapidQueue

Chrome extension + Native Messaging host для автоматизации скачивания с Rapidgator (free аккаунты).

## Возможности

✅ **Полная автоматизация 7 шагов:**
1. Cloudflare challenge (wait)
2. Info page (detect)
3. Free button (auto-click)
4. Timer wait
5. Cloudflare Turnstile (wait for solve)
6. Submit button (auto-click)
7. Download button (auto-click)

✅ **Умная очередь:**
- SQLite БД с retry logic (exponential backoff: 5 мин → 15 мин → 45 мин)
- Автоматический детект завершения/ошибки скачивания
- Persistence через chrome.storage.local (переживает редиректы)

✅ **Native Messaging:**
- .NET 9 stdio host
- Commands: add_url, get_next_pending, update_status, export_logs, set_debug

## Архитектура

```
┌─────────────────────┐
│  Chrome Extension   │ MV3
│  ┌───────────────┐  │
│  │ Popup UI      │  │ ← Добавление ссылок
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Content Script│  │ ← Детект страниц, автоклики
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Background SW │  │ ← Native Messaging, download tracking
│  └───────────────┘  │
└─────────┬───────────┘
          │ stdio
          ▼
┌─────────────────────┐
│  Native Host (.NET) │
│  ┌───────────────┐  │
│  │ SQLite Queue  │  │ ← QueueItem: Url, Status, FileName, ...
│  └───────────────┘  │
│  ┌───────────────┐  │
│  │ Retry Logic   │  │ ← Exponential backoff
│  └───────────────┘  │
└─────────────────────┘
```

## Установка

1. **Native Host:**
```bash
cd RapidQueue.NativeHost
dotnet publish -c Release -r win-x64 --self-contained
```

Добавить в реестр:
```
HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.rapidqueue.host
Default = D:\23-DotNet\RapidQueue\RapidQueue.NativeHost\bin\Release\net9.0\win-x64\publish\manifest.json
```

2. **Extension:**
- Открыть `chrome://extensions/`
- Включить "Режим разработчика"
- "Загрузить распакованное" → выбрать `RapidQueue.Extension/`
- Скопировать Extension ID в `RapidQueue.NativeHost/manifest.json`

## Использование

1. Кликнуть на иконку расширения → ввести URL Rapidgator
2. Расширение автоматически:
   - Откроет вкладку
   - Пройдёт все шаги (включая Turnstile)
   - Кликнет "СКАЧАТЬ ФАЙЛ"
   - Закроет вкладку после завершения
3. При ошибке лимита → автоматический retry через 5 минут

## Статус

⚠️ **В разработке** — текущая сборка исправляет проблему повторных кликов Free button.

См. [PROGRESS.md](PROGRESS.md) для подробностей.

## Технологии

- **Frontend:** Chrome Extension Manifest V3
- **Backend:** .NET 9, EF Core, SQLite
- **IPC:** Chrome Native Messaging (stdio)

## License

MIT
