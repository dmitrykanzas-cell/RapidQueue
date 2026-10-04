using Microsoft.EntityFrameworkCore;
using RapidQueue.Core.Data;
using RapidQueue.Core.Models;

namespace RapidQueue.Core.Services;

public class QueueService : IQueueService
{
    private readonly QueueDbContext _context;
    private readonly AppSettings _settings;

    public QueueService(QueueDbContext context, AppSettings settings)
    {
        _context = context;
        _settings = settings;
    }

    public async Task<QueueItem> AddAsync(string url)
    {
        var item = new QueueItem { Url = url };
        _context.QueueItems.Add(item);
        await _context.SaveChangesAsync();
        return item;
    }

    public async Task<List<QueueItem>> GetAllAsync()
    {
        return await _context.QueueItems
            .OrderBy(x => x.AddedAt)
            .ToListAsync();
    }

    public async Task<QueueItem?> GetNextPendingAsync()
    {
        return await _context.QueueItems
            .Where(x => x.Status == QueueItemStatus.Pending)
            .OrderBy(x => x.AddedAt)
            .FirstOrDefaultAsync();
    }

    public async Task UpdateAsync(QueueItem item)
    {
        _context.QueueItems.Update(item);
        await _context.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var item = await _context.QueueItems.FindAsync(id);
        if (item != null)
        {
            _context.QueueItems.Remove(item);
            await _context.SaveChangesAsync();
        }
    }

    public async Task<bool> CanProcessNextAsync()
    {
        var lastCompleted = await _context.QueueItems
            .Where(x => x.Status == QueueItemStatus.Completed && x.CompletedAt != null)
            .OrderByDescending(x => x.CompletedAt)
            .FirstOrDefaultAsync();

        if (lastCompleted?.CompletedAt == null)
            return true;

        var cooldownEnd = lastCompleted.CompletedAt.Value.AddMinutes(_settings.CooldownMinutes);
        return DateTime.UtcNow >= cooldownEnd;
    }
}
