const HOST_NAME = 'com.thinkpad.rapidqueue';
let debugMode = false;
let currentQueueItem = null;

// Load debug mode from storage
chrome.storage.sync.get({debugMode: false}, (result) => {
  debugMode = result.debugMode;
});

// Logging function
function log(category, message, data = null) {
  if (!debugMode) return;
  const entry = {
    timestamp: Date.now(),
    category,
    message,
    data
  };
  console.log(`[RapidQueue:${category}]`, message, data);
  
  chrome.storage.local.get({logs: []}, ({logs}) => {
    logs.push(entry);
    if (logs.length > 500) logs.shift();
    chrome.storage.local.set({logs});
  });
}

// Create alarms on install/update
chrome.runtime.onInstalled.addListener(() => {
  log('background', 'Extension installed/updated, creating alarms');
  chrome.alarms.create('poll_commands', {periodInMinutes: 1/30}); // ~2 sec
  chrome.alarms.create('poll_queue', {periodInMinutes: 1/12}); // ~5 sec
});

// Create alarms on startup (если расширение уже установлено)
chrome.runtime.onStartup.addListener(() => {
  log('background', 'Browser started, creating alarms');
  chrome.alarms.create('poll_commands', {periodInMinutes: 1/30});
  chrome.alarms.create('poll_queue', {periodInMinutes: 1/12});
});

// Создаём alarms сразу при первой загрузке service worker
chrome.alarms.create('poll_commands', {periodInMinutes: 1/30}); // ~2 sec
chrome.alarms.create('poll_queue', {periodInMinutes: 1/12}); // ~5 sec

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll_commands') {
    try {
      const response = await sendNativeMessage({action: 'poll_commands'});
      if (response.ok && response.commands && response.commands.length > 0) {
        log('polling', `Received ${response.commands.length} commands`, response.commands);
        for (const cmd of response.commands) {
          await executeCommand(cmd);
        }
      }
    } catch (err) {
      log('polling', 'Poll error', err.message);
    }
  }
  
  if (alarm.name === 'poll_queue') {
    if (currentQueueItem) return; // Already processing
    
    try {
      const response = await sendNativeMessage({action: 'get_next_pending'});
      if (response.ok && response.item) {
        currentQueueItem = response.item;
        console.log('[RapidQueue:queue] Got next item', currentQueueItem); // Всегда логируем, независимо от debug
        log('queue', 'Got next item', currentQueueItem);
        
        // Open tab with URL (API возвращает Url с заглавной буквы)
        const url = currentQueueItem.Url || currentQueueItem.url;
        const tab = await chrome.tabs.create({url: url, active: false});
        console.log('[RapidQueue:queue] Opened tab', {tabId: tab.id, url: url, itemId: currentQueueItem.Id});
        log('queue', 'Opened tab', {tabId: tab.id, url: url});
      } else {
        log('queue', 'No pending items', response);
      }
    } catch (err) {
      // Всегда логируем ошибки очереди (независимо от debug mode)
      console.error('[RapidQueue:queue] ERROR:', err);
      log('queue', 'Queue poll error', err.message);
    }
  }
});

// Execute command from native host
async function executeCommand(cmd) {
  log('command', 'Executing', cmd);
  
  if (cmd.type === 'set_debug') {
    debugMode = cmd.enabled;
    await chrome.storage.sync.set({debugMode});
    log('command', 'Debug mode set', debugMode);
    return;
  }
  
  if (cmd.type === 'dump_page') {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab) {
      log('command', 'No active tab');
      return;
    }
    
    const result = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: dumpPageState
    });
    
    const dump = result[0]?.result;
    await sendNativeMessage({action: 'save_result', result: dump});
    log('command', 'Page dumped', dump);
    return;
  }
  
  if (cmd.type === 'export_logs') {
    const {logs} = await chrome.storage.local.get({logs: []});
    await sendNativeMessage({action: 'save_result', result: {logs}});
    log('command', 'Logs exported', {count: logs.length});
    return;
  }
  
  if (cmd.type === 'click') {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab) return;
    
    await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: (selector) => document.querySelector(selector)?.click(),
      args: [cmd.selector]
    });
    log('command', 'Clicked', cmd.selector);
    return;
  }
  
  if (cmd.type === 'list_tabs') {
    const tabs = await chrome.tabs.query({});
    const tabList = tabs.map(t => ({id: t.id, url: t.url, title: t.title}));
    await sendNativeMessage({action: 'save_result', result: {tabs: tabList}});
    log('command', 'Tabs listed', {count: tabs.length});
    return;
  }
}

// Dump page state (runs in page context)
function dumpPageState() {
  return {
    url: location.href,
    title: document.title,
    html: document.documentElement.outerHTML.substring(0, 50000),
    iframes: [...document.querySelectorAll('iframe')].map(f => ({
      src: f.src,
      id: f.id,
      className: f.className
    })),
    selectors: {
      cloudflare: !!document.querySelector('iframe[src*="challenges.cloudflare"]'),
      timer: document.querySelector('#timeToDownload')?.textContent,
      captcha: !!document.querySelector('.g-recaptcha'),
      button: !!document.querySelector('#btn_download'),
      error: document.querySelector('.error-message')?.textContent
    },
    cookies: document.cookie
  };
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'PAGE_STATE') {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url;
    console.log('[RapidQueue:state] Page state from content script', {tabId, url, state: msg.state});
    log('state', 'Page state from content script', {tabId, url, state: msg.state});
    
    // Update queue item status if we have one
    if (currentQueueItem && tabId) {
      handlePageState(msg.state, tabId);
    }
    
    respond({ok: true});
    return;
  }
  
  if (msg.type === 'DOWNLOAD_STARTED') {
    log('download', 'Download started', msg);
    
    if (currentQueueItem) {
      sendNativeMessage({
        action: 'update_status',
        id: currentQueueItem.Id || currentQueueItem.id,
        status: 'Downloading',
        fileName: msg.fileName
      });
    }
    
    respond({ok: true});
    return;
  }
  
  if (msg.type === 'DEBUG_ALERT') {
    log('debug-alert', msg.message, msg.dump);
    respond({ok: true});
    return;
  }
});

// Handle page state changes
async function handlePageState(state, tabId) {
  if (state === 'cloudflare_challenge') {
    log('state', 'Cloudflare detected, updating status to AwaitingCaptcha');
    await sendNativeMessage({
      action: 'update_status',
      id: currentQueueItem.Id || currentQueueItem.id,
      status: 'AwaitingCaptcha'
    });
  }
  
  if (state === 'error') {
    log('state', 'Error detected, marking as Failed');
    await sendNativeMessage({
      action: 'update_status',
      id: currentQueueItem.Id || currentQueueItem.id,
      status: 'Failed',
      error: 'Error on page'
    });
    currentQueueItem = null;
    chrome.tabs.remove(tabId);
  }
}

// Intercept downloads
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  log('download', 'Download created', downloadItem);
  console.log('[RapidQueue:STEP-8] Download created:', downloadItem.id);

  if (currentQueueItem) {
    // Сохраняем downloadId для отслеживания в onChanged
    currentQueueItem.downloadId = downloadItem.id;
    
    // Извлекаем имя файла из URL (filename может быть пустым в onCreated)
    let fileName = downloadItem.filename;
    if (!fileName && downloadItem.finalUrl) {
      try {
        const url = new URL(downloadItem.finalUrl);
        fileName = url.pathname.split('/').pop() || '';
        fileName = decodeURIComponent(fileName);
      } catch (e) {
        console.error('[RapidQueue:download] Failed to extract filename from URL:', e);
      }
    }

    console.log('[RapidQueue:download] Marking item as Downloading:', currentQueueItem.Id || currentQueueItem.id, 'FileName:', fileName);
    await sendNativeMessage({
      action: 'update_status',
      id: currentQueueItem.Id || currentQueueItem.id,
      status: 'Downloading',
      fileName: fileName || 'unknown'
    });
    
    // НЕ закрываем вкладку и НЕ обнуляем currentQueueItem — ждём onChanged
  }
});

// Handle download completion or failure
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!currentQueueItem || currentQueueItem.downloadId !== delta.id) {
    return; // Не наш download
  }

  // Финальное состояние: complete
  if (delta.state && delta.state.current === 'complete') {
    console.log('[RapidQueue:download] Download completed:', delta.id);
    log('download', 'Download completed', delta);
    
    await sendNativeMessage({
      action: 'update_status',
      id: currentQueueItem.Id || currentQueueItem.id,
      status: 'Completed'
    });

    // Clear click flags for next item
    chrome.storage.local.remove(['rq_clickedFreeButton', 'rq_clickedDownloadButton', 'rq_clickedSubmitButton']);

    // Закрываем вкладку после успешного скачивания
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('rapidgator.net') || tab.url.includes('lossless-music.org'))) {
        console.log('[RapidQueue:download] Closing tab after completion:', tab.id);
        chrome.tabs.remove(tab.id);
      }
    }

    currentQueueItem = null;
  }

  // Финальное состояние: interrupted (ошибка)
  if (delta.state && delta.state.current === 'interrupted') {
    console.log('[RapidQueue:download] Download interrupted:', delta.id, delta.error);
    log('download', 'Download interrupted', {id: delta.id, error: delta.error});
    
    await sendNativeMessage({
      action: 'update_status',
      id: currentQueueItem.Id || currentQueueItem.id,
      status: 'Failed',
      error: `Download interrupted: ${delta.error?.current || 'unknown'}`
    });

    // Clear click flags for next item
    chrome.storage.local.remove(['rq_clickedFreeButton', 'rq_clickedDownloadButton', 'rq_clickedSubmitButton']);

    // Закрываем вкладку
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('rapidgator.net') || tab.url.includes('lossless-music.org'))) {
        console.log('[RapidQueue:download] Closing tab after error:', tab.id);
        chrome.tabs.remove(tab.id);
      }
    }

    currentQueueItem = null;
  }
});

// Send message to native host
function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, response => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

log('background', 'Service worker initialized');
