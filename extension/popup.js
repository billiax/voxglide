const serverUrlInput = document.getElementById('serverUrl');
const optAutoContext = document.getElementById('optAutoContext');
const optTts = document.getElementById('optTts');
const optDebug = document.getElementById('optDebug');
const contextArea = document.getElementById('context');
const autoInjectToggle = document.getElementById('autoInject');
const previewEl = document.getElementById('preview');
const injectBtn = document.getElementById('inject');
const statusEl = document.getElementById('status');
const adminLink = document.getElementById('adminLink');

// --- Option pill toggle ---

document.querySelectorAll('.option-pill').forEach(pill => {
  const checkbox = pill.querySelector('input[type="checkbox"]');
  // Sync initial state
  pill.classList.toggle('active', checkbox.checked);
  checkbox.addEventListener('change', () => {
    pill.classList.toggle('active', checkbox.checked);
  });
});

// --- URL helpers ---

function parseServerUrl(raw) {
  let url = raw.trim();
  if (!url) return null;

  // Add protocol if missing
  if (!/^https?:\/\//.test(url) && !/^wss?:\/\//.test(url)) {
    url = 'https://' + url;
  }

  try {
    const parsed = new URL(url);
    const isSecure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
    const httpBase = `${isSecure ? 'https' : 'http'}://${parsed.host}`;
    const wsBase = `${isSecure ? 'wss' : 'ws'}://${parsed.host}`;
    return { httpBase, wsBase };
  } catch {
    return null;
  }
}

function getScriptUrl(parsed) {
  return `${parsed.httpBase}/sdk/voice-sdk.iife.js`;
}

function getInitCode(parsed, options) {
  const config = { serverUrl: `'${parsed.wsBase}'` };
  if (options.autoContext) config.autoContext = 'true';
  if (options.tts) config.tts = 'true';
  if (options.debug) config.debug = 'true';
  if (options.context) config.context = `'${options.context.replace(/'/g, "\\'")}'`;

  const entries = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join(',\n');

  return `new VoiceSDK({\n${entries}\n});`;
}

function getOptions() {
  return {
    autoContext: optAutoContext.checked,
    tts: optTts.checked,
    debug: optDebug.checked,
    context: contextArea.value.trim(),
  };
}

// --- Preview ---

function updateAdminLink(parsed) {
  if (parsed) {
    adminLink.href = `${parsed.httpBase}/admin`;
    adminLink.classList.remove('disabled');
  } else {
    adminLink.removeAttribute('href');
    adminLink.classList.add('disabled');
  }
}

function updatePreview() {
  const parsed = parseServerUrl(serverUrlInput.value);
  updateAdminLink(parsed);
  if (!parsed) {
    previewEl.innerHTML = '<span class="empty-hint">Enter a server URL to see preview</span>';
    return;
  }

  const options = getOptions();
  const scriptUrl = getScriptUrl(parsed);
  const initCode = getInitCode(parsed, options);

  previewEl.innerHTML =
    `<span class="key">Script:</span> <span class="url">${escapeHtml(scriptUrl)}</span>\n\n` +
    `<span class="key">Init:</span>\n${escapeHtml(initCode)}`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Persistence ---

const STORAGE_KEYS = ['serverUrl', 'optAutoContext', 'optTts', 'optDebug', 'context', 'autoInject'];

function saveAll() {
  chrome.storage.local.set({
    serverUrl: serverUrlInput.value,
    optAutoContext: optAutoContext.checked,
    optTts: optTts.checked,
    optDebug: optDebug.checked,
    context: contextArea.value,
    autoInject: autoInjectToggle.checked,
  });
}

chrome.storage.local.get(STORAGE_KEYS, (data) => {
  serverUrlInput.value = data.serverUrl || '';
  optAutoContext.checked = data.optAutoContext !== undefined ? data.optAutoContext : true;
  optTts.checked = data.optTts !== undefined ? data.optTts : true;
  optDebug.checked = !!data.optDebug;
  contextArea.value = data.context || '';
  autoInjectToggle.checked = !!data.autoInject;
  // Sync pill states after loading
  document.querySelectorAll('.option-pill').forEach(pill => {
    const checkbox = pill.querySelector('input[type="checkbox"]');
    pill.classList.toggle('active', checkbox.checked);
  });
  updatePreview();
});

// Save & update preview on any change
for (const el of [serverUrlInput, contextArea]) {
  el.addEventListener('input', () => { saveAll(); updatePreview(); });
}
for (const el of [optAutoContext, optTts, optDebug, autoInjectToggle]) {
  el.addEventListener('change', () => { saveAll(); updatePreview(); });
}

// --- Admin link ---

adminLink.addEventListener('click', (e) => {
  e.preventDefault();
  if (adminLink.href) {
    chrome.tabs.create({ url: adminLink.href });
  }
});

// --- Inject ---

function showStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = type || '';
  if (type === 'success') {
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 2000);
  }
}

injectBtn.addEventListener('click', () => {
  const parsed = parseServerUrl(serverUrlInput.value);
  if (!parsed) {
    showStatus('Enter a valid server URL', 'error');
    return;
  }

  showStatus('Injecting...', '');

  const options = getOptions();
  const scriptUrl = getScriptUrl(parsed);
  const initCode = getInitCode(parsed, options);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.runtime.sendMessage(
      { action: 'inject', tabId: tabs[0].id, scriptUrl, initCode, httpBase: parsed.httpBase, tabUrl: tabs[0].url },
      (response) => {
        if (response?.success) {
          showStatus('Injected', 'success');
        } else {
          showStatus('Error: ' + (response?.error || 'Unknown'), 'error');
        }
      }
    );
  });
});
