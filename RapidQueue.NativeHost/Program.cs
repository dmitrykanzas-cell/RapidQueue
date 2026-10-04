using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RapidQueue.Core.Data;
using RapidQueue.Core.Models;

const string AppDataPath = "RapidQueue";
const int MaxMessageBytes = 4 * 1024 * 1024;

var appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppDataPath);
Directory.CreateDirectory(appData);

var commandsFile = Path.Combine(appData, "commands.json");
var resultsFile = Path.Combine(appData, "results.json");

// CLI mode: --inject-command <json>
if (args.Length >= 2 && args[0] == "--inject-command")
{
    var command = JsonDocument.Parse(args[1]).RootElement;
    var commands = File.Exists(commandsFile) 
        ? JsonSerializer.Deserialize<List<JsonElement>>(File.ReadAllText(commandsFile)) ?? new()
        : new();
    commands.Add(command);
    File.WriteAllText(commandsFile, JsonSerializer.Serialize(commands));
    Console.WriteLine($"Command injected: {command.GetProperty("type").GetString()}");
    return 0;
}

// Native Messaging stdio mode
var input = Console.OpenStandardInput();
var output = Console.OpenStandardOutput();

var hostLog = Path.Combine(appData, "host.log");
HostLog(hostLog, "startup", "native host started (stdio mode)");

while (true)
{
    var message = await ReadMessageAsync(input);
    if (message is null)
    {
        HostLog(hostLog, "shutdown", "stdin closed, exiting");
        break;
    }

    HostLog(hostLog, "recv", message);

    object response;
    try
    {
        using var document = JsonDocument.Parse(message);
        response = await HandleAsync(document.RootElement, appData);
    }
    catch (Exception ex)
    {
        response = new { ok = false, error = ex.Message };
        HostLog(hostLog, "error", $"{ex.GetType().Name}: {ex.Message}");
    }

    HostLog(hostLog, "send", JsonSerializer.Serialize(response));
    await WriteMessageAsync(output, response);
}

return 0;

static void HostLog(string logPath, string category, string message)
{
    try
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff} [{category}] {message}";
        File.AppendAllText(logPath, line + Environment.NewLine);
    }
    catch
    {
        // логирование не должно ломать обмен сообщениями
    }
}

static async Task<object> HandleAsync(JsonElement request, string appData)
{
    var action = request.GetProperty("action").GetString();

    // Poll commands from file
    if (action == "poll_commands")
    {
        var commandsFile = Path.Combine(appData, "commands.json");
        if (!File.Exists(commandsFile))
            return new { ok = true, commands = Array.Empty<object>() };

        var commandsJson = await File.ReadAllTextAsync(commandsFile);
        var commands = JsonSerializer.Deserialize<List<JsonElement>>(commandsJson) ?? new();
        File.Delete(commandsFile); // Clear after reading
        return new { ok = true, commands };
    }

    // Save result from extension
    if (action == "save_result")
    {
        var result = request.GetProperty("result");
        var resultsFile = Path.Combine(appData, "results.json");
        await File.WriteAllTextAsync(resultsFile, JsonSerializer.Serialize(result));
        return new { ok = true };
    }

    // Get next pending queue item
    if (action == "get_next_pending")
    {
        var dbPath = Path.Combine(appData, "queue.db");
        var options = new DbContextOptionsBuilder<QueueDbContext>()
            .UseSqlite($"Data Source={dbPath}")
            .Options;
        using var db = new QueueDbContext(options);
        
        var item = await db.QueueItems
            .Where(q => q.Status == QueueItemStatus.Pending && 
                       (q.NextAvailableAt == null || q.NextAvailableAt <= DateTime.UtcNow))
            .OrderBy(q => q.AddedAt)
            .FirstOrDefaultAsync();

        if (item == null)
            return new { ok = true, item = (object?)null };

        item.Status = QueueItemStatus.Processing;
        item.StartedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return new { ok = true, item = new { item.Id, item.Url, item.Status } };
    }

    // Update queue item status
    if (action == "update_status")
    {
        var id = request.GetProperty("id").GetInt32();
        var status = Enum.Parse<QueueItemStatus>(request.GetProperty("status").GetString()!);
        var errorMessage = request.TryGetProperty("error", out var err) ? err.GetString() : null;
        var fileName = request.TryGetProperty("fileName", out var fn) ? fn.GetString() : null;

        var dbPath = Path.Combine(appData, "queue.db");
        var options = new DbContextOptionsBuilder<QueueDbContext>()
            .UseSqlite($"Data Source={dbPath}")
            .Options;
        using var db = new QueueDbContext(options);
        var item = await db.QueueItems.FindAsync(id);
        
        if (item == null)
            return new { ok = false, error = "Queue item not found" };

        item.Status = status;
        item.ErrorMessage = errorMessage;
        item.FileName = fileName;

        if (status == QueueItemStatus.Completed)
            item.CompletedAt = DateTime.UtcNow;
        
        if (status == QueueItemStatus.Failed)
        {
            item.RetryCount++;
            if (item.RetryCount < 3)
            {
                item.Status = QueueItemStatus.Pending;
                // Exponential backoff: 5m, 10m, 20m
                var delayMinutes = 5 * Math.Pow(2, item.RetryCount - 1);
                item.NextAvailableAt = DateTime.UtcNow.AddMinutes(delayMinutes);
            }
        }

        await db.SaveChangesAsync();
        return new { ok = true };
    }

    // Ping
    if (action == "ping")
    {
        return new 
        { 
            ok = true, 
            host = "RapidQueue.NativeHost", 
            version = "0.1.0",
            appData
        };
    }

    return new { ok = false, error = $"Unknown action: {action}" };
}

static async Task<string?> ReadMessageAsync(Stream input)
{
    var lengthBytes = new byte[4];
    var read = await input.ReadAsync(lengthBytes);
    if (read != 4) return null;

    var length = BitConverter.ToInt32(lengthBytes, 0);
    if (length <= 0 || length > MaxMessageBytes) return null;

    var messageBytes = new byte[length];
    var totalRead = 0;
    while (totalRead < length)
    {
        var chunk = await input.ReadAsync(messageBytes.AsMemory(totalRead, length - totalRead));
        if (chunk == 0) return null;
        totalRead += chunk;
    }

    return Encoding.UTF8.GetString(messageBytes);
}

static async Task WriteMessageAsync(Stream output, object response)
{
    var json = JsonSerializer.Serialize(response);
    var messageBytes = Encoding.UTF8.GetBytes(json);
    var lengthBytes = BitConverter.GetBytes(messageBytes.Length);

    await output.WriteAsync(lengthBytes);
    await output.WriteAsync(messageBytes);
    await output.FlushAsync();
}
