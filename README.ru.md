# RapidQueue

Приложение для Windows, которое помогает управлять очередью загрузок с файлообменников, соблюдая лимиты и интервалы. Уведомляет через Telegram, когда требуется пройти капчу или загрузка завершена.

## Возможности

- ✅ Очередь ссылок с сохранением в SQLite
- ✅ Автоматическое ожидание кулдауна между загрузками (по умолчанию 120 минут)
- ✅ Детект состояний страницы: Cloudflare challenge, Rapidgator таймер, капча, rate limit
- ✅ Перехват загрузки файлов через Playwright
- ✅ Уведомления: локальные (звук) + Telegram с inline-кнопками
- 🚧 Live-view через CDP для удалённого прохождения капчи (в разработке)
- 🚧 Tailscale-интеграция для безопасного доступа с телефона (в разработке)

## Требования

- Windows 10+
- .NET 9.0 Runtime
- Chrome (установлен системно)
- (Опционально) Telegram Bot Token + Chat ID для уведомлений
- (Опционально) Tailscale для удалённого доступа с телефона

## Установка

### 1. Клонировать репозиторий

```bash
git clone https://github.com/dmitrykanzas-cell/RapidQueue.git
cd RapidQueue
```

### 2. Собрать проект

```bash
dotnet build -c Release
```

### 3. (Опционально) Настроить Telegram-бота

1. Откройте Telegram, найдите [@BotFather](https://t.me/BotFather)
2. Отправьте `/newbot` и следуйте инструкциям
3. Скопируйте токен (например, `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Узнайте ваш Chat ID через [@userinfobot](https://t.me/userinfobot)

Откройте файл конфигурации приложения или укажите переменные окружения:

```bash
set RAPIDQUEUE_TELEGRAM_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
set RAPIDQUEUE_TELEGRAM_CHATID=987654321
```

### 4. (Опционально) Установить Tailscale

**На ПК:**

1. Скачайте Tailscale: https://tailscale.com/download/windows
2. Установите и войдите в аккаунт
3. Запомните имя устройства (например, `thinkpad`)

**На телефоне (Android/iOS):**

1. Установите Tailscale из Play Store / App Store
2. Войдите в тот же аккаунт
3. В настройках Android включите **Always-on VPN** для Tailscale (Settings → Network & Internet → VPN → Tailscale → Always-on)

Теперь ваш ПК и телефон находятся в одной приватной сети.

## Использование

### Запуск приложения

```bash
cd RapidQueue\RapidQueue.App\bin\Release\net9.0-windows
RapidQueue.App.exe
```

Или через Visual Studio / Rider / dotnet CLI:

```bash
dotnet run --project RapidQueue.App
```

### Добавление ссылок

1. Вставьте одну или несколько ссылок в текстовое поле (по одной на строку)
2. Нажмите **"➕ Добавить"**
3. Ссылки появятся в очереди сверху

### Запуск обработки

1. Нажмите **"▶️ Старт"**
2. Приложение откроет браузер и начнёт обработку первой ссылки в очереди
3. Когда потребуется капча:
   - Прозвучит системный звук
   - Придёт уведомление в Telegram с кнопкой **"🔐 Открыть браузер"**
   - Откройте ссылку (с телефона через Tailscale или на ПК)
   - Пройдите капчу
   - Приложение продолжит автоматически

### Пауза

Нажмите **"⏸️ Пауза"**, чтобы остановить обработку. Текущая загрузка завершится, следующие элементы останутся в очереди.

### Удаление элемента

Выделите строку в списке и нажмите **"🗑️ Удалить"**.

## Архитектура

```
RapidQueue/
├── RapidQueue.Core/          # Модели, БД (EF Core + SQLite), бизнес-логика
├── RapidQueue.Automation/    # Playwright, CDP, Telegram, QueueProcessor
├── RapidQueue.App/           # WinForms UI
└── RapidQueue.Tests/         # xUnit тесты
```

### Состояния элемента очереди

- `Pending` — ожидает обработки
- `Processing` — обрабатывается сейчас
- `AwaitingCaptcha` — требуется ручное прохождение капчи
- `Downloading` — идёт загрузка файла
- `Completed` — успешно завершено
- `Failed` — ошибка
- `Paused` — приостановлено (лимит или вручную)

### Детект состояний страницы

| Состояние | Описание | Действие |
|---|---|---|
| `CloudflareChallenge` | Cloudflare проверка безопасности | Уведомление → ждём решения |
| `RapidgatorTimer` | 120-секундный таймер перед загрузкой | Ждём, затем кликаем и перехватываем файл |
| `RapidgatorCaptcha` | reCAPTCHA или Turnstile | Уведомление → ждём решения |
| `RateLimited` | Достигнут лимит (обычно 2 часа) | Пауза, NextAvailableAt |
| `DownloadReady` | Кнопка загрузки доступна | Клик, перехват файла |

## Настройки

Файл `%LOCALAPPDATA%\RapidQueue\settings.json` (создаётся автоматически):

```json
{
  "DownloadDirectory": "C:\\Users\\<User>\\Music\\RapidQueue",
  "BrowserProfilePath": "C:\\Users\\<User>\\AppData\\Local\\RapidQueue\\browser_profile",
  "TelegramBotToken": null,
  "TelegramChatId": null,
  "CooldownMinutes": 120,
  "MaxRetries": 3,
  "EnableNotifications": true,
  "EnableTelegramNotifications": false
}
```

Измените `CooldownMinutes`, если файлообменник имеет другой лимит.

## Troubleshooting

### Приложение не открывается / падает сразу

Убедитесь, что установлен .NET 9.0 Runtime:

```bash
dotnet --list-runtimes
```

Если нет — скачайте: https://dotnet.microsoft.com/download/dotnet/9.0

### Playwright не находит браузер

Установите Chrome вручную или выполните:

```bash
playwright install chrome
```

### Капча не проходится автоматически

Это нормально. Приложение **не обходит капчу**, а уведомляет вас, чтобы вы прошли её вручную. Откройте ссылку из Telegram-уведомления или подойдите к ПК.

### Telegram-уведомления не приходят

1. Проверьте токен и Chat ID
2. Убедитесь, что бот активен (отправьте ему `/start`)
3. Проверьте, что `EnableTelegramNotifications` = `true` в settings.json

### Tailscale-ссылка не открывается с телефона

1. Убедитесь, что Tailscale запущен и на ПК, и на телефоне
2. Проверьте имя устройства: `tailscale status`
3. Попробуйте открыть `http://100.x.x.x:8765/live` вместо доменного имени

## Roadmap

- [x] Базовая очередь + кулдаун
- [x] Playwright persistent profile
- [x] Детект состояний Rapidgator
- [x] Telegram уведомления
- [x] WinForms UI
- [ ] CDP live-view для удалённого прохождения капчи
- [ ] Tailscale serve для HTTPS
- [ ] Автоматическое обновление статуса после решения капчи
- [ ] Статистика: сколько файлов скачано, среднее время
- [ ] Поддержка других файлообменников (Turbobit, Uploaded, etc.)
- [ ] Портативная версия (single-file publish)

## Лицензия

MIT

## Автор

Создано для автоматизации загрузок с соблюдением лимитов файлообменников. Не предназначено для обхода защиты или нарушения ToS.

---

**Важно:** Это приложение помогает соблюдать интервалы и уведомляет вас, когда требуется ваше участие. Оно **не обходит капчу** автоматически — вы решаете её сами, своими руками, через удалённый просмотр браузера.
