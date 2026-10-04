namespace RapidQueue.Core.Models;

public class AppSettings
{
    public required string DownloadDirectory { get; set; }
    public required string BrowserProfilePath { get; set; }
    public string? TelegramBotToken { get; set; }
    public long? TelegramChatId { get; set; }
    public int CooldownMinutes { get; set; } = 120;
    public int MaxRetries { get; set; } = 3;
    public bool EnableNotifications { get; set; } = true;
    public bool EnableTelegramNotifications { get; set; } = false;
}
