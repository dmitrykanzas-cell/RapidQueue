# RapidQueue Development Progress

## Текущий статус (2026-10-04)

### ✅ Реализовано

1. **Chrome Extension (MV3)**
   - Popup UI для добавления ссылок
   - Content-script с автоматическим детектом страниц Rapidgator
   - Background service worker с Native Messaging
   - Логирование и debug mode

2. **Native Host (.NET 9)**
   - SQLite БД для очереди (QueueItem: Id, Url, Status, FileName, AddedAt, StartedAt, RetryCount, ErrorMessage, NextAvailableAt)
   - Native Messaging stdio protocol
   - Commands: add_url, get_next_pending, update_status, export_logs, set_debug
   - Retry logic с exponential backoff (5 мин → 15 мин → 45 мин)

3. **Автоматизация Rapidgator (7 шагов)**
   - ✅ Шаг 1: Cloudflare challenge (wait)
   - ✅ Шаг 2: Info page (detect)
   - ✅ Шаг 3: Free button click
   - ✅ Шаг 4: Timer wait
   - ✅ Шаг 5: Cloudflare Turnstile (wait for value.length > 100)
   - ✅ Шаг 6: Submit button auto-click
   - ✅ Шаг 7: "СКАЧАТЬ ФАЙЛ" button auto-click

4. **Download lifecycle**
   - chrome.downloads.onCreated → статус Downloading
   - chrome.downloads.onChanged (state: 'complete') → статус Completed + закрыть вкладку
   - chrome.downloads.onChanged (state: 'interrupted') → статус Failed + retry

---

## 🚧 В работе

### Проблема #16: Повторные клики Free button

**Симптом:** Free button кликается каждые 2 секунды, таймер сбрасывается.

**Причина:** 
- `chrome.storage.local.set()` асинхронный
- Клик происходит ДО завершения сохранения флага
- Редирект загружает новую страницу → флаг не загружен → кнопка кликается снова

**Исправление (в процессе):**
```javascript
// Было:
clickedFreeButton = true;
chrome.storage.local.set({rq_clickedFreeButton: true});
state.freeButton.click(); // Клик ДО сохранения!

// Стало:
clickedFreeButton = true;
chrome.storage.local.set({rq_clickedFreeButton: true}, () => {
  state.freeButton.click(); // Клик ПОСЛЕ сохранения
});
```

**Статус:** Исправлено в коде (commit pending), требует тестирования.

---

## 📋 TODO

### Высокий приоритет

1. **Тестировать проблему #16** — перезагрузить расширение, проверить что Free button кликается только один раз
2. **Детект ошибки лимита** — селектор `.error-message` не работает, найти правильный
3. **LiveView (задача #4)** — CDP screencast + Input.dispatchMouseEvent через локальный веб-сервер для визуального мониторинга

### Средний приоритет

4. **Таймаут на Downloading** — если скачивание не завершилось за 10 минут → Failed
5. **Очистка старых Failed items** — автоматически удалять items старше 7 дней
6. **Статистика** — dashboard: сколько скачано, сколько failed, средний retry count

### Низкий приоритет

7. **Поддержка premium аккаунтов** — bypass Free flow, прямое скачивание
8. **Batch operations** — bulk add URLs, bulk retry
9. **Уведомления** — Windows notifications при завершении/ошибке

---

## 🐛 Известные баги

1. **Native Host падает при KeyNotFoundException** (исправлено)
2. **sessionStorage не переживает редиректы** (заменён на chrome.storage.local)
3. **observer.observe() дублируется** (исправлено — запускается только в chrome.storage.local.get callback)
4. **Turnstile submit button selector** — `submitBtn` undefined, исправлено на `document.querySelector('button[type="submit"]')`

---

## 📁 Структура проекта

```
RapidQueue/
├── RapidQueue.Extension/      # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── background.js           # Service worker, Native Messaging
│   ├── content-script.js       # Page state detection, auto-clicks
│   ├── popup.html/js/css       # UI для добавления ссылок
│   └── icon128.png
├── RapidQueue.NativeHost/      # .NET 9 stdio Native Messaging host
│   ├── Program.cs
│   ├── Models/
│   │   └── NativeMessage.cs
│   └── manifest.json           # Chrome Native Messaging manifest
├── RapidQueue.Core/            # Shared library
│   ├── Data/
│   │   └── QueueDbContext.cs   # EF Core SQLite
│   └── Models/
│       └── QueueItem.cs        # Id, Url, Status, FileName, ...
└── RapidQueue.Tests/           # Ad-hoc test scripts (dotnet run)
```

---

## 🔧 Настройка

### Extension ID
```
lbaabdjcmiepdjonbgkjkcmbionehkej
```

### Native Host registry
```
HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.rapidqueue.host
Default = D:\23-DotNet\RapidQueue\RapidQueue.NativeHost\bin\Release\net9.0\win-x64\publish\manifest.json
```

### БД
```
C:\Users\ThinkPad\AppData\Local\RapidQueue\queue.db
```

### Логи
```
C:\Users\ThinkPad\AppData\Local\RapidQueue\host.log
C:\Users\ThinkPad\AppData\Local\RapidQueue\results.json (export_logs)
```

---

## 🎯 Цель проекта

Автоматизировать **все** клики на Rapidgator для free пользователей:
1. ✅ Кнопка "Free download"
2. ✅ Cloudflare Turnstile (автоклик submit когда решён)
3. ✅ Кнопка "СКАЧАТЬ ФАЙЛ"
4. ❌ Кнопка "медленное скачивание" — **НЕ автоматизируется** (требует ручного клика)

**Итоговый flow:** Пользователь добавляет ссылку → расширение делает всё остальное → файл скачивается.

---

## 🚀 Следующий шаг

1. Перезагрузить расширение
2. Добавить item #22 в очередь (уже Pending)
3. Проверить логи — `free_button_clicked` должен быть **только один раз**
4. Если таймер идёт нормально → **проблема #16 решена ✅**
5. Закоммитить изменения
6. Перейти к задаче #4 (LiveView)

