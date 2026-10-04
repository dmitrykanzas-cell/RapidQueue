using Microsoft.EntityFrameworkCore;
using RapidQueue.Core.Models;

namespace RapidQueue.Core.Data;

public class QueueDbContext : DbContext
{
    public DbSet<QueueItem> QueueItems => Set<QueueItem>();

    public QueueDbContext(DbContextOptions<QueueDbContext> options) : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<QueueItem>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Url).IsRequired().HasMaxLength(2048);
            entity.Property(e => e.Status).IsRequired();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.AddedAt);
        });
    }
}
