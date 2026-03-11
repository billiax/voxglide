// Fetch SDK script (bypasses CSP/mixed content) and inject with init code
async function injectIntoTab(tabId, scriptUrl, initCode) {
  let combinedCode = '';

  if (scriptUrl) {
    const response = await fetch(scriptUrl, {
      headers: { 'ngrok-skip-browser-warning': '1' },
    });
    if (!response.ok) throw new Error(`Failed to fetch ${scriptUrl}: ${response.status}`);
    combinedCode = await response.text();
  }

  if (initCode) {
    combinedCode += '\n;\n' + initCode;
  }

  if (!combinedCode) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code) => { new Function(code)(); },
    args: [combinedCode],
  });
}

// Build injection params from stored settings
function buildInjectionParams(data) {
  const url = (data.serverUrl || '').trim();
  if (!url) return null;

  let normalized = url;
  if (!/^https?:\/\//.test(normalized) && !/^wss?:\/\//.test(normalized)) {
    normalized = 'https://' + normalized;
  }

  let parsed;
  try { parsed = new URL(normalized); } catch { return null; }

  const isSecure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  const httpBase = `${isSecure ? 'https' : 'http'}://${parsed.host}`;
  const wsBase = `${isSecure ? 'wss' : 'ws'}://${parsed.host}`;

  const scriptUrl = `${httpBase}/sdk/voice-sdk.iife.js`;

  const config = { serverUrl: `'${wsBase}'` };
  if (data.optAutoContext !== false) config.autoContext = 'true';
  if (data.optTts !== false) config.tts = 'true';
  if (data.optDebug) config.debug = 'true';
  if (data.context && data.context.trim()) {
    config.context = `'${data.context.trim().replace(/'/g, "\\'")}'`;
  }

  const entries = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join(',\n');

  const initCode = `new VoiceSDK({\n${entries}\n});`;

  return { scriptUrl, initCode };
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'inject') {
    injectIntoTab(msg.tabId, msg.scriptUrl, msg.initCode)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Auto-inject on page load when enabled
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !/^https?:\/\//.test(tab.url)) return;

  chrome.storage.local.get(
    ['serverUrl', 'optAutoContext', 'optTts', 'optDebug', 'context', 'autoInject'],
    (data) => {
      if (!data.autoInject) return;

      const params = buildInjectionParams(data);
      if (!params) return;

      injectIntoTab(tabId, params.scriptUrl, params.initCode).catch(() => {});
    }
  );
});
