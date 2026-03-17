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

// UI Settings
const uiSettingsToggle = document.getElementById('uiSettingsToggle');
const uiSettingsArrow = document.getElementById('uiSettingsArrow');
const uiSettingsBody = document.getElementById('uiSettingsBody');
const positionGrid = document.getElementById('positionGrid');
const sizeGroup = document.getElementById('sizeGroup');
const themeGroup = document.getElementById('themeGroup');
const accentColorInput = document.getElementById('accentColor');
const accentColorLabel = document.getElementById('accentColorLabel');
const offsetXInput = document.getElementById('offsetX');
const offsetYInput = document.getElementById('offsetY');

// UI Settings state
let uiPosition = 'bottom-right';
let uiSize = 'md';
let uiTheme = 'auto';
let uiAccentColor = '#2563eb';
let uiSettingsOpen = false;

// --- Option pill toggle ---

document.querySelectorAll('.option-pill').forEach(pill => {
  const checkbox = pill.querySelector('input[type="checkbox"]');
  // Sync initial state
  pill.classList.toggle('active', checkbox.checked);
  checkbox.addEventListener('change', () => {
    pill.classList.toggle('active', checkbox.checked);
  });
});

// --- UI Settings toggle ---

uiSettingsToggle.addEventListener('click', () => {
  uiSettingsOpen = !uiSettingsOpen;
  uiSettingsBody.style.display = uiSettingsOpen ? '' : 'none';
  uiSettingsArrow.classList.toggle('open', uiSettingsOpen);
  saveAll();
});

// Position grid
positionGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.pos-cell');
  if (!cell) return;
  positionGrid.querySelectorAll('.pos-cell').forEach(c => c.classList.remove('active'));
  cell.classList.add('active');
  uiPosition = cell.dataset.pos;
  saveAll(); updatePreview();
});

// Size pills
sizeGroup.addEventListener('click', (e) => {
  const pill = e.target.closest('.ui-pill');
  if (!pill) return;
  sizeGroup.querySelectorAll('.ui-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  uiSize = pill.dataset.val;
  saveAll(); updatePreview();
});

// Theme pills
themeGroup.addEventListener('click', (e) => {
  const pill = e.target.closest('.ui-pill');
  if (!pill) return;
  themeGroup.querySelectorAll('.ui-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  uiTheme = pill.dataset.val;
  saveAll(); updatePreview();
});

// Accent color
accentColorInput.addEventListener('input', () => {
  uiAccentColor = accentColorInput.value;
  accentColorLabel.textContent = uiAccentColor;
  saveAll(); updatePreview();
});

// Offset
offsetXInput.addEventListener('input', () => { saveAll(); updatePreview(); });
offsetYInput.addEventListener('input', () => { saveAll(); updatePreview(); });

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

function buildUiConfigStr(options) {
  const uiLines = [];
  if (options.position !== 'bottom-right') uiLines.push(`    position: '${options.position}'`);
  if (options.offsetX !== 20 || options.offsetY !== 20) {
    uiLines.push(`    offset: { x: ${options.offsetX}, y: ${options.offsetY} }`);
  }
  const themeLines = [];
  if (options.size !== 'md') themeLines.push(`      size: '${options.size}'`);
  if (options.theme === 'dark') {
    themeLines.push("      preset: 'dark'", "      colorScheme: 'dark'");
  } else if (options.theme === 'light') {
    themeLines.push("      preset: 'light'", "      colorScheme: 'light'");
  }
  if (options.accentColor !== '#2563eb') {
    themeLines.push(`      colors: { primary: '${options.accentColor}' }`);
  }
  if (themeLines.length > 0) {
    uiLines.push('    theme: {\n' + themeLines.join(',\n') + '\n    }');
  }
  return uiLines;
}

function getInitCode(parsed, options) {
  const lines = [];
  lines.push(`  serverUrl: '${parsed.wsBase}'`);
  if (options.autoContext) lines.push('  autoContext: true');
  if (options.tts) lines.push('  tts: true');
  if (options.debug) lines.push('  debug: true');
  if (options.context) lines.push(`  context: '${options.context.replace(/'/g, "\\'")}'`);

  const uiLines = buildUiConfigStr(options);
  if (uiLines.length > 0) {
    lines.push('  ui: {\n' + uiLines.join(',\n') + '\n  }');
  }

  return `new VoiceSDK({\n${lines.join(',\n')}\n});`;
}

function getOptions() {
  return {
    autoContext: optAutoContext.checked,
    tts: optTts.checked,
    debug: optDebug.checked,
    context: contextArea.value.trim(),
    position: uiPosition,
    size: uiSize,
    theme: uiTheme,
    accentColor: uiAccentColor,
    offsetX: parseInt(offsetXInput.value, 10) || 20,
    offsetY: parseInt(offsetYInput.value, 10) || 20,
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

const STORAGE_KEYS = [
  'serverUrl', 'optAutoContext', 'optTts', 'optDebug', 'context', 'autoInject',
  'uiPosition', 'uiSize', 'uiTheme', 'uiAccentColor', 'uiOffsetX', 'uiOffsetY', 'uiSettingsOpen',
];

function saveAll() {
  chrome.storage.local.set({
    serverUrl: serverUrlInput.value,
    optAutoContext: optAutoContext.checked,
    optTts: optTts.checked,
    optDebug: optDebug.checked,
    context: contextArea.value,
    autoInject: autoInjectToggle.checked,
    uiPosition: uiPosition,
    uiSize: uiSize,
    uiTheme: uiTheme,
    uiAccentColor: uiAccentColor,
    uiOffsetX: parseInt(offsetXInput.value, 10) || 20,
    uiOffsetY: parseInt(offsetYInput.value, 10) || 20,
    uiSettingsOpen: uiSettingsOpen,
  });
}

function applyUiState() {
  // Position grid
  positionGrid.querySelectorAll('.pos-cell').forEach(c => {
    c.classList.toggle('active', c.dataset.pos === uiPosition);
  });
  // Size pills
  sizeGroup.querySelectorAll('.ui-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.val === uiSize);
  });
  // Theme pills
  themeGroup.querySelectorAll('.ui-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.val === uiTheme);
  });
  // Color
  accentColorInput.value = uiAccentColor;
  accentColorLabel.textContent = uiAccentColor;
  // Section open state
  uiSettingsBody.style.display = uiSettingsOpen ? '' : 'none';
  uiSettingsArrow.classList.toggle('open', uiSettingsOpen);
}

chrome.storage.local.get(STORAGE_KEYS, (data) => {
  serverUrlInput.value = data.serverUrl || '';
  optAutoContext.checked = data.optAutoContext !== undefined ? data.optAutoContext : true;
  optTts.checked = data.optTts !== undefined ? data.optTts : true;
  optDebug.checked = !!data.optDebug;
  contextArea.value = data.context || '';
  autoInjectToggle.checked = !!data.autoInject;
  // UI settings
  uiPosition = data.uiPosition || 'bottom-right';
  uiSize = data.uiSize || 'md';
  uiTheme = data.uiTheme || 'auto';
  uiAccentColor = data.uiAccentColor || '#2563eb';
  offsetXInput.value = data.uiOffsetX !== undefined ? data.uiOffsetX : 20;
  offsetYInput.value = data.uiOffsetY !== undefined ? data.uiOffsetY : 20;
  uiSettingsOpen = !!data.uiSettingsOpen;
  applyUiState();
  // Sync option pill states after loading
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
