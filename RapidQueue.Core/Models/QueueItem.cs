namespace RapidQueue.Core.Models;

public enum QueueItemStatus
{
    Pending,
    Processing,
    AwaitingCaptcha,
    Downloading,
    Completed,
    Failed,
    Paused
}

public class QueueItem
{
    public int Id { get; set; }
    public required string Url { get; set; }
    public QueueItemStatus Status { get; set; } = QueueItemStatus.Pending;
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? NextAvailableAt { get; set; }
    public string? ErrorMessage { get; set; }
    public string? FileName { get; set; }
    public string? DownloadPath { get; set; }
    public int RetryCount { get; set; }
}
