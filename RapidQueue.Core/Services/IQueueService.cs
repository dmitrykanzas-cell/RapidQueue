using RapidQueue.Core.Models;

namespace RapidQueue.Core.Services;

public interface IQueueService
{
    Task<QueueItem> AddAsync(string url);
    Task<List<QueueItem>> GetAllAsync();
    Task<QueueItem?> GetNextPendingAsync();
    Task UpdateAsync(QueueItem item);
    Task DeleteAsync(int id);
    Task<bool> CanProcessNextAsync();
}
