# RapidQueue — Документация проекта

## Оглавление
1. [Описание проекта](#описание-проекта)
2. [Архитектура](#архитектура)
3. [Последовательность работы](#последовательность-работы)
4. [Компоненты](#компоненты)
5. [Что сделано](#что-сделано)
6. [Текущие проблемы](#текущие-проблемы)
7. [Что осталось](#что-осталось)
8. [Установка и запуск](#установка-и-запуск)

---

## Описание проекта

**RapidQueue** — приложение для полуавтоматической загрузки файлов с Rapidgator через очередь. 

### Цель
Скачивать lossless-релизы с [lossless-music.org](https://lossless-music.org) (с файлами на Rapidgator) в фоновом режиме, обходя ограничения бесплатного аккаунта:
- Таймер ожидания 120 секунд перед скачиванием
- Cooldown между файлами
- Cloudflare Turnstile challenge на lossless-music.org

### Особенности
- **Полуавтомат**: капчи проходит человек, всё остальное автоматизировано
- **Очередь**: добавляешь несколько ссылок, приложение обрабатывает их по одной с учётом таймеров
- **Уведомления**: Telegram-бот сообщает, когда капча нужна или файл скачан
- **Chrome Extension**: работает в реальном профиле Chrome без детекции автоматизации

---

## Архитектура

### Старая архитектура (отказались)
- **Playwright** → CDP → headless Chrome
- **Проблема**: Cloudflare Turnstile детектирует автоматизацию, все stealth-плагины не работают с 2024 года

### Текущая архитектура (Chrome Extension + Native Messaging)

```
┌─────────────────────────────────────────────────────────────┐
│                        User                                  │
│  (проходит капчи руками, добавляет URL в очередь)            │
└──────────────────┬──────────────────────────────────────────┘
                   │
    ┌──────────────┴─────────────┐
    │                            │
    v                            v
┌─────────────┐          ┌─────────────┐
│ WinForms    │          │  Telegram   │
│ RapidQueue  │          │  Bot        │
│    .App     │          │ @RapidQueue │
└──────┬──────┘          └──────┬──────┘
       │                        │
       │                        │
       v                        v
┌────────────────────────────────────┐
│      SQLite (queue.db)              │
│  QueueItems: Id, Url, Status, ...  │
└────────────┬───────────────────────┘
             │
             │ (EF Core)
             v
┌────────────────────────────────────┐
│   RapidQueue.NativeHost.exe        │
│  (stdio JSON, CLI inject-command)  │
│                                    │
│  Commands:                         │
│  - get_next_pending                │
│  - update_status                   │
│  - poll_commands                   │
│  - save_result                     │
└────────────┬───────────────────────┘
             │
             │ (Native Messaging)
             │ (stdio JSON)
             v
┌────────────────────────────────────┐
│  Chrome Extension                  │
│  (MV3, background service worker)  │
│                                    │
│  background.js:                    │
│  - Polling commands (2s)           │
│  - Polling queue (5s)              │
│  - chrome.downloads перехват       │
│                                    │
│  content-script.js:                │
│  - MutationObserver                │
│  - Детект состояний                │
│  - Автоклик кнопок                 │
└────────────┬───────────────────────┘
             │
             v
┌────────────────────────────────────┐
│  Chrome Browser (реальный профиль) │
│  - lossless-music.org              │
│  - rapidgator.net                  │
│  - cf_clearance cookie             │
└────────────────────────────────────┘
```

### Взаимодействие компонентов

1. **WinForms** → SQLite: добавляет URL в очередь (статус `Pending`)
2. **Native Host** опрашивает SQLite каждые 5 секунд (`get_next_pending`)
3. **Native Host** → Extension: отправляет команду `open_url` через `commands.json`
4. **Extension** опрашивает `commands.json` каждые 2 секунды (`poll_commands`)
5. **Extension** → Chrome: открывает вкладку с URL (`chrome.tabs.create`)
6. **Content-script** детектирует состояние страницы через DOM-селекторы
7. **Content-script** → Background: отправляет событие `PAGE_STATE`
8. **Background** → Native Host: обновляет статус через `sendNativeMessage`
9. **Native Host** → SQLite: записывает статус в БД
10. **WinForms** → UI: обновляет список очереди

---

## Последовательность работы

### Полный цикл одной загрузки

#### 1. Добавление URL в очередь
**Действие**: Пользователь вставляет ссылку в WinForms или через Telegram-бота  
**Пример**: `https://lossless-music.org/download/90701/phibes-bassdrop-2023-flac`  
**Результат**: Запись в БД, статус `Pending` (0)

---

#### 2. Native Host: polling очереди
**Периодичность**: каждые 5 секунд  
**Команда**: `get_next_pending`  
**Логика**:
```sql
SELECT * FROM QueueItems 
WHERE Status = 0 
ORDER BY AddedAt ASC 
LIMIT 1
```
**Результат**: JSON с Id, Url, Status

---

#### 3. Extension: открытие вкладки
**Trigger**: `poll_commands` получил команду `open_url`  
**Действие**:
```javascript
chrome.tabs.create({
  url: 'https://lossless-music.org/download/90701/...',
  active: false
});
```
**Результат**: Новая вкладка в фоне, статус обновляется на `Processing` (1)

---

#### 4. Страница 1: lossless-music.org (Cloudflare Challenge)

**URL**: `https://lossless-music.org/download/90701/phibes-bassdrop-2023-flac`  
**Что видит пользователь**: Cloudflare Turnstile — крутящийся спиннер или чекбокс  
**Селектор**: `iframe[src*="challenges.cloudflare"]` или `title` содержит "момент"  

**Детектор content-script**:
```javascript
cloudflare: !!document.querySelector('iframe[src*="challenges.cloudflare"]') || 
            document.title.toLowerCase().includes('момент')
```

**Событие**: `PAGE_STATE` → `cloudflare_challenge`  
**Статус в БД**: `AwaitingCaptcha` (2)  
**Действие пользователя**: Решить капчу руками (клик или автопрохождение)

---

#### 5. Страница 2: lossless-music.org (информация о релизе)

**URL**: `https://lossless-music.org/download/90701/phibes-bassdrop-2023-flac` (после капчи)  
**Что видит пользователь**: Страница релиза — обложка, треклист, описание, **ссылка на Rapidgator**  

**Селектор**: `a[href*="rapidgator.net"]`

**Детектор content-script**:
```javascript
rapidgatorLink: document.querySelector('a[href*="rapidgator.net"]')

if (state.rapidgatorLink && location.hostname.includes('lossless-music')) {
  state.rapidgatorLink.click();
  return 'rapidgator_redirect';
}
```

**Событие**: `PAGE_STATE` → `rapidgator_redirect`  
**Действие**: Автоматический клик ссылки  
**Результат**: Переход на Rapidgator

---

#### 6. Страница 3: Rapidgator (информация о файле)

**URL**: `https://rapidgator.net/file/b8a53ae2b41f49baf5a86d2c3c5ed76f/Phibes_-_Bassdrop-WEB-FLAC-2023.rar.html`  
**Что видит пользователь**:
- Имя файла: `Phibes_-_Bassdrop-WEB-FLAC-2023.rar`
- Размер: 20.51 MB
- Таблица Free vs Premium
- **Кнопка "МЕДЛЕННОЕ СКАЧИВАНИЕ"** (синяя)

**Селектор**: `a.btn-free` или `a[href*="download/AjaxStartTimer"]`

**Детектор content-script**:
```javascript
freeButton: document.querySelector('a.btn-free, a[href*="download/AjaxStartTimer"]')

if (state.freeButton) {
  state.freeButton.click();
  return 'free_button_clicked';
}
```

**Событие**: `PAGE_STATE` → `free_button_clicked`  
**Действие**: Автоматический клик кнопки  
**Результат**: Переход на страницу с таймером  

**⚠️ ТЕКУЩАЯ ПРОБЛЕМА**: Chrome зависает после клика (бесконечный цикл MutationObserver)

---

#### 7. Страница 4: Rapidgator (таймер ожидания)

**URL**: `https://rapidgator.net/file/b8a53ae2b41f49baf5a86d2c3c5ed76f/Phibes_-_Bassdrop-WEB-FLAC-2023.rar.html` (после AJAX)  
**Что видит пользователь**:
- Таймер: "Осталось 120 секунд"
- Прогресс-бар

**Селектор**: `#timeToDownload`

**Детектор content-script**:
```javascript
timer: document.querySelector('#timeToDownload')

if (state.timer) {
  const seconds = parseInt(state.timer.textContent.match(/\d+/)?.[0] || '0');
  
  if (seconds > 0) {
    setTimeout(() => {
      checkForButton();
    }, (seconds + 1) * 1000);
  }
  
  return 'timer_waiting';
}
```

**Событие**: `PAGE_STATE` → `timer_waiting`  
**Статус в БД**: `Downloading` (3) или остаётся `Processing` (1)  
**Действие**: Ждать N секунд

---

#### 8. Страница 5: Rapidgator (кнопка скачивания)

**URL**: та же (DOM обновляется после таймера)  
**Что видит пользователь**: Кнопка "СКАЧАТЬ ФАЙЛ" (зелёная)

**Селектор**: `#btn_download` или `a.btn_download`

**Детектор content-script**:
```javascript
button: document.querySelector('#btn_download, a.btn_download')

if (state.button) {
  clickDownloadButton(state.button);
  return 'button_ready';
}
```

**Событие**: `PAGE_STATE` → `button_ready`  
**Действие**: Автоматический клик кнопки  
**Результат**: Скачивание начинается

---

#### 9. Перехват скачивания

**Событие**: `chrome.downloads.onCreated`

**Обработчик background.js**:
```javascript
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (currentQueueItem) {
    sendNativeMessage({
      action: 'update_status',
      id: currentQueueItem.Id,
      status: 'Completed',
      fileName: downloadItem.filename
    });
    
    currentQueueItem = null;
  }
});
```

**Статус в БД**: `Completed` (4)  
**Уведомление**: Telegram-бот → "Файл скачан: Phibes_-_Bassdrop-WEB-FLAC-2023.rar"

---

### Статусы QueueItem

| Значение | Название          | Описание                                       |
|----------|-------------------|------------------------------------------------|
| 0        | Pending           | Ожидает обработки                              |
| 1        | Processing        | Вкладка открыта, идёт обработка                |
| 2        | AwaitingCaptcha   | Ждёт капчу от пользователя                     |
| 3        | Downloading       | Скачивание началось                            |
| 4        | Completed         | Скачивание завершено                           |
| 5        | Failed            | Ошибка (файл не найден, сеть, etc.)           |
| 6        | Cancelled         | Отменено пользователем                         |

---

## Компоненты

### 1. RapidQueue.Core
**Технологии**: .NET 9, EF Core, SQLite  
**Ответственность**: Модели данных и хранилище  

**Файлы**:
- `Models/QueueItem.cs` — модель записи очереди (Id, Url, Status, AddedAt, CompletedAt, FileName, ErrorMessage)
- `Data/QueueDbContext.cs` — EF Core DbContext для SQLite
- `Services/QueueService.cs` — бизнес-логика: добавление URL, получение следующего pending, обновление статуса, кулдаун 120 секунд

**База данных**: `C:\Users\ThinkPad\AppData\Local\RapidQueue\queue.db`

---

### 2. RapidQueue.NativeHost
**Технологии**: .NET 9, System.Text.Json  
**Ответственность**: Stdio JSON bridge между Chrome Extension и SQLite  

**Файлы**:
- `Program.cs` — stdio loop, CLI режим (`--inject-command`), команды (ping, poll_commands, get_next_pending, update_status, save_result)
- `host-manifest.template.json` — шаблон манифеста Chrome Native Messaging

**Регистрация**:
```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.thinkpad.rapidqueue
→ D:\23-DotNet\RapidQueue\RapidQueue.NativeHost\publish\host-manifest.json
```

**Логи**: `C:\Users\ThinkPad\AppData\Local\RapidQueue\host.log` (каждое stdio сообщение)

**CLI использование**:
```bash
cd /d/23-DotNet/RapidQueue/RapidQueue.NativeHost
dotnet run -- --inject-command '{"type":"ping"}'
dotnet run -- --inject-command '{"type":"dump_page"}'
dotnet run -- --inject-command '{"type":"export_logs"}'
```

---

### 3. RapidQueue.Extension
**Технологии**: Chrome MV3, JavaScript, Native Messaging  
**Ответственность**: Детект состояний страницы, автоматизация кликов, перехват скачиваний  

**Файлы**:

#### `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "RapidQueue",
  "version": "0.1.0",
  "permissions": ["storage", "tabs", "downloads", "nativeMessaging", "scripting", "alarms"],
  "host_permissions": [
    "*://lossless-music.org/*",
    "*://rapidgator.net/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://lossless-music.org/*", "*://rapidgator.net/*"],
      "js": ["content-script.js"]
    }
  ]
}
```

#### `background.js`
**Задачи**:
- Polling commands из Native Host (каждые 2 секунды через `chrome.alarms`)
- Polling queue (`get_next_pending`) каждые 5 секунд
- Открытие вкладок (`chrome.tabs.create`)
- Обработка событий `PAGE_STATE` от content-script
- Обновление статуса через `sendNativeMessage`
- Перехват `chrome.downloads.onCreated`

**Ключевые функции**:
```javascript
async function sendNativeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      'com.thinkpad.rapidqueue',
      message,
      (response) => resolve(response)
    );
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll_commands') {
    const response = await sendNativeMessage({action: 'poll_commands'});
    // выполнить команды
  }
  
  if (alarm.name === 'poll_queue') {
    const response = await sendNativeMessage({action: 'get_next_pending'});
    if (response.ok && response.item) {
      const tab = await chrome.tabs.create({url: response.item.Url, active: false});
      currentQueueItem = response.item;
    }
  }
});
```

#### `content-script.js`
**Задачи**:
- MutationObserver для отслеживания изменений DOM
- Детект состояний через селекторы
- Автоклик кнопок/ссылок
- Отправка событий `PAGE_STATE` в background

**Детекторы**:
```javascript
const state = {
  cloudflare: !!document.querySelector('iframe[src*="challenges.cloudflare"]'),
  rapidgatorLink: document.querySelector('a[href*="rapidgator.net"]'),
  freeButton: document.querySelector('a.btn-free, a[href*="download/AjaxStartTimer"]'),
  timer: document.querySelector('#timeToDownload'),
  button: document.querySelector('#btn_download, a.btn_download'),
  captcha: document.querySelector('.g-recaptcha'),
  error: document.querySelector('.error-message, .alert-danger')
};
```

**⚠️ ПРОБЛЕМА**: MutationObserver → detectPageState → click → DOM change → снова MutationObserver (бесконечный цикл)

#### `popup.html` + `popup.js`
**UI для пользователя**:
- Toggle debug mode
- Dump page button
- Export logs button
- Real-time log viewer (последние 20 записей)

---

### 4. RapidQueue.App
**Технологии**: .NET 9, WinForms  
**Ответственность**: UI для управления очередью  

**Файлы**:
- `MainForm.cs` — ListView очереди, кнопки добавления/удаления/старт/пауза
- `Program.cs` — DI (QueueService + MainForm), точка входа

**Функции**:
- Добавить URL вручную (TextBox) или из буфера обмена (batch)
- Удалить выбранную запись
- Просмотр статуса очереди (реальное время)
- Старт/пауза обработки (пока не реализовано — Extension работает автономно)

---

## Что сделано

### ✅ Архитектура и инфраструктура
- [x] Переход с Playwright на Chrome Extension + Native Messaging
- [x] Native Host (stdio JSON loop, CLI inject-command)
- [x] Регистрация Native Host в реестре Windows
- [x] Chrome Extension MV3 (manifest, background service worker, content-script)
- [x] SQLite БД + EF Core модели
- [x] WinForms UI (базовое)

### ✅ Queue Polling
- [x] `chrome.alarms` для polling (работает после перезагрузки расширения)
- [x] Native Host: `get_next_pending` каждые 5 секунд
- [x] Extension: `poll_commands` каждые 2 секунды
- [x] Открытие вкладки с URL из очереди

### ✅ Детект состояний
- [x] Cloudflare Turnstile challenge (селектор iframe)
- [x] lossless-music.org → Rapidgator link (автоклик)
- [x] Rapidgator Free button (детект, автоклик)
- [x] Таймер (селектор `#timeToDownload`, setTimeout)
- [x] Кнопка скачивания (селектор `#btn_download`)
- [x] Ошибки (селектор `.error-message`)

### ✅ Логирование и отладка
- [x] Native Host → `host.log` (все stdio сообщения)
- [x] Extension → chrome.storage.local (rolling buffer 500 записей)
- [x] CLI команды: `dump_page`, `export_logs`, `list_tabs`, `set_debug`
- [x] Console.log в background.js и content-script.js (всегда, независимо от debug mode)

### ✅ Интеграция
- [x] Extension → Native Host → SQLite (update_status работает)
- [x] WinForms → SQLite (добавление URL)
- [x] Background.js → content-script → PAGE_STATE события

---

## Текущие проблемы

### 🔴 Критическая: Chrome зависает после клика Free button

**Симптомы**:
- Content-script кликает кнопку "Медленное скачивание"
- Событие `free_button_clicked` логируется многократно
- Chrome перестаёт отвечать
- Требуется `taskkill /F /IM chrome.exe`

**Причина**:
Бесконечный цикл:
```
MutationObserver 
→ detectPageState() 
→ state.freeButton.click() 
→ DOM mutation 
→ MutationObserver 
→ снова detectPageState() 
→ снова click()
```

**Решение (TODO)**:
```javascript
let clickedFreeButton = false;

if (state.freeButton && !clickedFreeButton) {
  clickedFreeButton = true;
  state.freeButton.click();
  observer.disconnect(); // Отключить наблюдатель после клика
  return 'free_button_clicked';
}
```

---

### 🟡 Средняя: Селектор Free button может быть неточным

**Текущий селектор**: `a.btn-free, a[href*="download/AjaxStartTimer"]`

**Проблема**: Не проверено на реальной странице Rapidgator (Chrome зависал до дампа HTML)

**TODO**: Сделать dump страницы и проверить реальный HTML кнопки

---

### 🟡 Средняя: Content-script не перезапускается на старых вкладках

**Сценарий**:
1. Открыта вкладка Rapidgator
2. Расширение перезагружается (reload)
3. Content-script НЕ инжектится в уже открытую вкладку

**Решение**: Либо закрывать вкладку после завершения, либо перезагружать страницу через `chrome.tabs.reload(tabId)`

---

### 🟢 Низкая: Статус в БД не всегда корректный

**Проблема**: Статус обновляется на `AwaitingCaptcha` при каждом событии `cloudflare_challenge`, даже если капча уже пройдена (многократные вызовы)

**Решение**: Проверять текущий статус перед update — не обновлять, если уже `AwaitingCaptcha`

---

## Что осталось

### 🔥 Приоритет 1: Исправить зависание Chrome
- [ ] Добавить флаг `clickedFreeButton` в content-script
- [ ] Отключать MutationObserver после клика
- [ ] Протестировать без зависания

### 🔥 Приоритет 2: Дойти до конца цепочки
- [ ] Убедиться, что после клика Free button загружается страница с таймером
- [ ] Детектировать таймер 120 секунд
- [ ] Ждать таймер (setTimeout)
- [ ] Детектировать кнопку скачивания
- [ ] Кликнуть кнопку скачивания
- [ ] Перехватить `chrome.downloads.onCreated`
- [ ] Обновить статус на `Completed`

### 🔧 Приоритет 3: Улучшения и фичи
- [ ] Telegram-бот: уведомления о капче и завершении
- [ ] Telegram-бот: команды добавления URL в очередь
- [ ] WinForms: real-time обновление статусов (ObservableCollection или timer)
- [ ] WinForms: кнопка Pause/Resume (остановить polling)
- [ ] Native Host: команда `get_tab_info` для отладки конкретной вкладки
- [ ] Extension popup: показывать текущий item из очереди
- [ ] Cooldown между файлами (2 часа для Rapidgator free)
- [ ] Retry при ошибке (3 попытки с backoff)
- [ ] Закрытие вкладки после успешного скачивания

### 🎨 Приоритет 4: Полировка
- [ ] Иконка для расширения (128x128 PNG)
- [ ] Сборка installer для WinForms
- [ ] README.md с инструкцией установки
- [ ] GitHub Actions CI/CD (build + release)
- [ ] Unit-тесты для QueueService
- [ ] Integration-тесты для Native Host

---

## Установка и запуск

### Требования
- Windows 10/11
- .NET 9 SDK
- Chrome (любая актуальная версия)
- Git

### 1. Клонировать репозиторий
```bash
git clone https://github.com/dmitrykanzas-cell/RapidQueue.git
cd RapidQueue
```

### 2. Собрать Native Host
```bash
cd RapidQueue.NativeHost
dotnet publish -c Release -r win-x64 --self-contained false -o publish
```

### 3. Зарегистрировать Native Host
```bash
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.thinkpad.rapidqueue" /ve /t REG_SZ /d "D:\23-DotNet\RapidQueue\RapidQueue.NativeHost\publish\host-manifest.json" /f
```

**⚠️ Важно**: В `publish/host-manifest.json` прописать правильный путь к `.exe` и ID расширения:
```json
{
  "name": "com.thinkpad.rapidqueue",
  "description": "RapidQueue native messaging host",
  "path": "D:\\23-DotNet\\RapidQueue\\RapidQueue.NativeHost\\publish\\RapidQueue.NativeHost.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://lbaabdjcmiepdjonbgkjkcmbionehkej/"
  ]
}
```

### 4. Установить Extension в Chrome
1. Открыть `chrome://extensions/`
2. Включить **Developer mode** (переключатель справа вверху)
3. Нажать **Load unpacked**
4. Выбрать папку `D:\23-DotNet\RapidQueue\RapidQueue.Extension`
5. Скопировать **ID расширения** (например, `lbaabdjcmiepdjonbgkjkcmbionehkej`)
6. Вставить ID в `host-manifest.json` (см. шаг 3)
7. Перезагрузить расширение (круговая стрелка)

### 5. Запустить WinForms приложение
```bash
cd RapidQueue.App
dotnet run
```

### 6. Добавить тестовый URL
1. В WinForms: вставить URL в TextBox и нажать "Add"
2. Или напрямую в БД:
```bash
cd RapidQueue.Tests
dotnet run
```

### 7. Проверить логи
```bash
# Native Host логи
tail -50 C:/Users/ThinkPad/AppData/Local/RapidQueue/host.log

# Extension логи (через CLI)
cd RapidQueue.NativeHost
dotnet run -- --inject-command '{"type":"export_logs"}'
cat C:/Users/ThinkPad/AppData/Local/RapidQueue/results.json

# Или в Chrome DevTools
# chrome://extensions/ → RapidQueue → "service worker" → Console
```

---

## Диаграмма состояний QueueItem

```
    [User добавляет URL]
            │
            v
        ┌─────────┐
        │ Pending │ (0)
        └────┬────┘
             │
             │ [Extension открывает вкладку]
             v
      ┌────────────┐
      │ Processing │ (1)
      └──────┬─────┘
             │
             ├─────→ [Cloudflare] ────→ ┌──────────────────┐
             │                           │ AwaitingCaptcha  │ (2)
             │                           └────────┬─────────┘
             │                                    │ [User решает капчу]
             │                                    │
             │←───────────────────────────────────┘
             │
             ├─────→ [Rapidgator link] ─→ (остаётся Processing)
             │
             ├─────→ [Free button] ─────→ (остаётся Processing)
             │
             ├─────→ [Timer 120s] ──────→ (остаётся Processing или → Downloading)
             │
             ├─────→ [Download button] ─→ ┌─────────────┐
             │                             │ Downloading │ (3)
             │                             └──────┬──────┘
             │                                    │ [chrome.downloads.onCreated]
             │                                    v
             │                             ┌───────────┐
             │                             │ Completed │ (4)
             │                             └───────────┘
             │
             └─────→ [Ошибка] ───────────→ ┌────────┐
                                            │ Failed │ (5)
                                            └────────┘
```

---

## Технологический стек

| Компонент          | Технология                  |
|--------------------|-----------------------------|
| Backend            | .NET 9, C# 13               |
| Database           | SQLite + EF Core            |
| UI                 | WinForms                    |
| Extension          | Chrome MV3, JavaScript ES6  |
| Native Messaging   | stdio JSON                  |
| Build              | dotnet CLI                  |
| VCS                | Git, GitHub                 |
| OS                 | Windows 10/11               |

---

## Авторы
- Dmitry Dutov (dmitrykanzas-cell)

## Лицензия
Публичный репозиторий, без явной лицензии (по умолчанию все права защищены).

---

Последнее обновление: 2026-10-04, 00:50
