let debugMode = false;

// Флаги для защиты от повторных кликов (persist across redirects via chrome.storage.local)
let clickedRapidgatorLink = false;
let clickedFreeButton = false;
let clickedDownloadButton = false;
let clickedCaptchaSubmit = false;

// Load debug mode and click flags from storage
chrome.storage.sync.get({debugMode: false}, (result) => {
  debugMode = result.debugMode;
});

chrome.storage.local.get(['rq_clickedFreeButton', 'rq_clickedDownloadButton', 'rq_clickedSubmitButton'], (result) => {
  clickedFreeButton = result.rq_clickedFreeButton || false;
  clickedDownloadButton = result.rq_clickedDownloadButton || false;
  clickedCaptchaSubmit = result.rq_clickedSubmitButton || false;
  
  log('init', 'Content script loaded', {
    url: window.location.href,
    debugMode: debugMode,
    clickedFreeButton,
    clickedDownloadButton,
    clickedCaptchaSubmit
  });
  
  // Start observing after flags are loaded
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Initial state check
  const initialState = detectPageState();
  chrome.runtime.sendMessage({type: 'PAGE_STATE', state: initialState});
});

function log(category, message, data = null) {
  if (!debugMode) return;
  const entry = {
    timestamp: Date.now(),
    category,
    message,
    data
  };
  chrome.runtime.sendMessage({type: 'LOG', entry});
}

// Detect page state
function detectPageState() {
  const state = {
    cloudflare: !!document.querySelector('iframe[src*="challenges.cloudflare"]') || 
                document.title.toLowerCase().includes('момент'),
    timer: document.querySelector('#timeToDownload'),
    captcha: document.querySelector('.g-recaptcha'),
    captchaText: location.hostname.includes('rapidgator.net') && location.pathname === '/download/captcha',
    button: document.querySelector('.btn-download, #btn_download, a.btn_download'),
    freeButton: document.querySelector('a.btn-free, a[href*="download/AjaxStartTimer"]'),
    rapidgatorLink: document.querySelector('a[href*="rapidgator.net"]'),
    error: document.querySelector('.error-message, .alert-danger')
  };

  // Логируем текущую страницу для отладки
  console.log('[RapidQueue:detect] Current page:', {
    url: location.href,
    hostname: location.hostname,
    pathname: location.pathname,
    title: document.title,
    detected: {
      cloudflare: state.cloudflare,
      timer: !!state.timer,
      captchaText: state.captchaText,
      freeButton: !!state.freeButton,
      rapidgatorLink: !!state.rapidgatorLink,
      button: !!state.button
    }
  });

  if (state.cloudflare) {
    log('detect', 'Cloudflare Turnstile detected');
    console.log('[RapidQueue:STEP-1] Cloudflare challenge detected');
    return 'cloudflare_challenge';
  }

  // lossless-music.org: ссылка на Rapidgator после капчи
  if (state.rapidgatorLink && location.hostname.includes('lossless-music') && !clickedRapidgatorLink) {
    clickedRapidgatorLink = true;
    log('detect', 'Rapidgator link found, clicking', {href: state.rapidgatorLink.href});
    console.log('[RapidQueue:STEP-2] Rapidgator link found, clicking:', state.rapidgatorLink.href);

    // Отключаем observer перед кликом
    observer.disconnect();

    state.rapidgatorLink.click();
    return 'rapidgator_redirect';
  }

  // Rapidgator: кнопка "Free download" перед таймером
  if (state.freeButton && !clickedFreeButton) {
    clickedFreeButton = true;
    
    chrome.storage.local.set({rq_clickedFreeButton: true}, () => {
      log('detect', 'Free download button detected, clicking', {
        href: state.freeButton.href,
        className: state.freeButton.className,
        text: state.freeButton.textContent?.trim()
      });
      console.log('[RapidQueue:STEP-3] Free button detected, clicking');
      console.log('[RapidQueue:button] Free button element:', state.freeButton);

      // Отключаем observer перед кликом
      observer.disconnect();

      state.freeButton.click();

    // Ждём 3 секунды, затем включаем observer обратно и проверяем состояние
    setTimeout(() => {
      console.log('[RapidQueue:button] Re-enabling observer after free button click');
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      const newState = detectPageState();
      console.log('[RapidQueue:button] State after free button click:', newState);
      chrome.runtime.sendMessage({type: 'PAGE_STATE', state: newState});
    }, 3000);
    }); // End of chrome.storage.local.set callback

    return 'free_button_clicked';
  }

  if (state.timer) {
    const seconds = parseInt(state.timer.textContent.match(/\d+/)?.[0] || '0');
    log('detect', `Timer detected: ${seconds}s`);
    console.log('[RapidQueue:STEP-4] Timer detected:', seconds, 'seconds remaining');

    if (seconds > 0) {
      setTimeout(() => {
        log('timer', 'Timer expired, checking for button');
        console.log('[RapidQueue:STEP-4] Timer expired, checking for next page');
        checkForButton();
      }, (seconds + 1) * 1000);
    }

    return 'timer_waiting';
  }

  // Rapidgator: Cloudflare Turnstile капча с автосабмитом
  if (state.captchaText) {
    const turnstile = document.querySelector('.cf-turnstile');
    const hiddenInput = document.querySelector('input[name="cf-turnstile-response"]');
    const submitBtn = document.querySelector('#submit-button, a.btn[onclick*="submit"]');

    console.log('[RapidQueue:STEP-5] Captcha page detected');
    console.log('[RapidQueue:STEP-5] Turnstile:', !!turnstile, 'Hidden input:', !!hiddenInput, 'Submit btn:', !!submitBtn);

    if (turnstile && hiddenInput && submitBtn && !clickedCaptchaSubmit) {
      log('captcha', 'Turnstile captcha detected, watching for completion');
      console.log('[RapidQueue:STEP-5] Setting up Turnstile completion watcher');

      // Проверяем каждые 500мс, решена ли капча
      const checkInterval = setInterval(() => {
        const value = hiddenInput.value || '';
        console.log('[RapidQueue:STEP-5] Checking Turnstile... value length:', value.length);
        
        if (value.length > 100 && !clickedCaptchaSubmit) {
          clearInterval(checkInterval);
          clickedCaptchaSubmit = true;
          
          chrome.storage.local.set({rq_clickedSubmitButton: true}, () => {
            log('captcha', 'Turnstile solved, auto-submitting');
            console.log('[RapidQueue:STEP-6] Turnstile solved! Auto-clicking submit button');
          
            const submitButton = document.querySelector('button[type="submit"]');
            if (submitButton) {
              submitButton.click();
            }
          });
        }
      }, 500);
    }

    return 'captcha_turnstile';
  }

  if (state.captcha) {
    log('detect', 'reCAPTCHA detected');
    console.log('[RapidQueue:captcha] reCAPTCHA detected');
    return 'captcha';
  }

  if (state.button && !clickedDownloadButton) {
    clickedDownloadButton = true;
    
    chrome.storage.local.set({rq_clickedDownloadButton: true}, () => {
      log('detect', 'Download button detected');
      console.log('[RapidQueue:STEP-7] Download button detected, clicking');
      clickDownloadButton(state.button);
    });
    return 'button_ready';
  }

  if (state.error) {
    log('detect', 'Error message detected', state.error.textContent);
    return 'error';
  }

  log('detect', 'Unknown page state');
  
  if (debugMode) {
    chrome.runtime.sendMessage({
      type: 'DEBUG_ALERT',
      message: 'Unknown page state detected',
      dump: {
        url: location.href,
        title: document.title,
        html: document.body?.innerHTML.substring(0, 5000)
      }
    });
  }
  
  return 'unknown';
}

function checkForButton() {
  const button = document.querySelector('#btn_download, a.btn_download');
  if (button && !clickedDownloadButton) {
    clickedDownloadButton = true;
    
    chrome.storage.local.set({rq_clickedDownloadButton: true}, () => {
      log('button', 'Button appeared after timer');
      console.log('[RapidQueue:download] Download button appeared after timer, clicking');
      clickDownloadButton(button);
    });
  } else if (clickedDownloadButton) {
    console.log('[RapidQueue:download] Button already clicked, skipping');
  } else {
    log('button', 'Button not found after timer');
    console.log('[RapidQueue:download] Download button not found after timer');
  }
}

function clickDownloadButton(button) {
  log('button', 'Clicking download button', {href: button.href, text: button.textContent});
  button.click();
  
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_STARTED',
    fileName: extractFileName(button.href || location.href)
  });
}

function extractFileName(url) {
  try {
    const match = url.match(/\/([^\/]+\.(?:flac|mp3|wav|m4a|zip|rar))/i);
    return match ? match[1] : 'download';
  } catch {
    return 'download';
  }
}

// Reset flags on new page (when URL changes)
let lastUrl = location.href;
function resetFlagsIfNeeded() {
  if (location.href !== lastUrl) {
    console.log('[RapidQueue:content] URL changed, resetting click flags', {
      old: lastUrl,
      new: location.href
    });
    lastUrl = location.href;
    clickedRapidgatorLink = false;
    clickedFreeButton = false;
    clickedDownloadButton = false;
  }
}

// Initial detection
setTimeout(() => {
  resetFlagsIfNeeded();
  const state = detectPageState();
  console.log('[RapidQueue:content] Initial state', {url: location.href, title: document.title, state});
  chrome.runtime.sendMessage({type: 'PAGE_STATE', state});
}, 1000);

// Watch for DOM changes
const observer = new MutationObserver((mutations) => {
  if (mutations.some(m => m.addedNodes.length > 0)) {
    resetFlagsIfNeeded(); // Проверяем, не изменился ли URL
    log('dom', 'DOM changed, re-detecting state');
    const state = detectPageState();
    console.log('[RapidQueue:content] State after DOM change', {url: location.href, state});
    chrome.runtime.sendMessage({type: 'PAGE_STATE', state});
  }
});

console.log('[RapidQueue:content] Initialized', {url: location.href, title: document.title});
log('content-script', 'Initialized', {url: location.href});
