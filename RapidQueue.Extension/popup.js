const debugCheckbox = document.getElementById('debugMode');
const logsDiv = document.getElementById('logs');

// Load and display debug mode
chrome.storage.sync.get({debugMode: false}, (result) => {
  debugCheckbox.checked = result.debugMode;
});

// Toggle debug mode
debugCheckbox.addEventListener('change', () => {
  chrome.storage.sync.set({debugMode: debugCheckbox.checked});
});

// Dump current page
document.getElementById('dumpPage').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'INJECT_COMMAND', command: {type: 'dump_page'}});
  alert('Page dump requested. Check C:\\Users\\ThinkPad\\AppData\\Local\\RapidQueue\\results.json');
});

// Export logs
document.getElementById('exportLogs').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type: 'INJECT_COMMAND', command: {type: 'export_logs'}});
  alert('Logs exported to results.json');
});

// Clear logs
document.getElementById('clearLogs').addEventListener('click', () => {
  chrome.storage.local.set({logs: []});
  logsDiv.innerHTML = '';
});

// Display recent logs
function updateLogs() {
  chrome.storage.local.get({logs: []}, ({logs}) => {
    const recent = logs.slice(-20);
    logsDiv.innerHTML = recent.map(entry => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      return `<div class="log-entry">
        <span class="log-time">${time}</span>
        <span class="log-category">[${entry.category}]</span>
        ${entry.message}
      </div>`;
    }).join('');
  });
}

updateLogs();
setInterval(updateLogs, 2000);
