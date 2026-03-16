// Inject code into a tab's MAIN world
async function executeInTab(tabId, code) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (c) => { new Function(c)(); },
    args: [code],
  });
}

// Check if VoiceSDK is already active in a tab (avoids killing a live session on SPA nav)
async function isSDKAlreadyActive(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => !!(window.__voxglideInstance),
    });
    return results?.[0]?.result === true;
  } catch {
    return false;
  }
}

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

  await executeInTab(tabId, combinedCode);
}

// After SDK injection, check if nbt_functions should be auto-injected for this domain
async function injectNbtFunctions(tabId, httpBase, tabUrl) {
  try {
    const manifestUrl = `${httpBase}/sdk/functions/manifest.json`;
    const res = await fetch(manifestUrl, {
      headers: { 'ngrok-skip-browser-warning': '1' },
    });
    if (!res.ok) return;

    const manifest = await res.json();
    if (!manifest.functions || !Array.isArray(manifest.functions)) return;

    const hostname = new URL(tabUrl).hostname;

    for (const entry of manifest.functions) {
      if (!entry.match || !entry.script) continue;
      if (!hostname.includes(entry.match)) continue;

      const scriptUrl = `${httpBase}/sdk/functions/${entry.script}`;
      const scriptRes = await fetch(scriptUrl, {
        headers: { 'ngrok-skip-browser-warning': '1' },
      });
      if (!scriptRes.ok) continue;

      const code = await scriptRes.text();
      await executeInTab(tabId, code);
    }
  } catch {
    // Fail silently — nbt_functions injection is best-effort
  }
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
  // Always enable reconnect so the session survives hard navigations
  config.autoReconnect = 'true';
  if (data.context && data.context.trim()) {
    config.context = `'${data.context.trim().replace(/'/g, "\\'")}'`;
  }

  const entries = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join(',\n');

  const initCode = `new VoiceSDK({\n${entries}\n});`;

  return { scriptUrl, initCode, httpBase };
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'inject') {
    injectIntoTab(msg.tabId, msg.scriptUrl, msg.initCode)
      .then(async () => {
        if (msg.httpBase && msg.tabUrl) {
          await injectNbtFunctions(msg.tabId, msg.httpBase, msg.tabUrl);
        }
        sendResponse({ success: true });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Debounce auto-injection per tab to prevent duplicate injections.
// Next.js/SPAs can fire tabs.onUpdated with status='complete' multiple times
// during hydration or client-side navigation within the same page load.
const pendingInjections = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !/^https?:\/\//.test(tab.url)) return;

  // Clear any pending injection for this tab (debounce)
  if (pendingInjections.has(tabId)) {
    clearTimeout(pendingInjections.get(tabId));
  }

  pendingInjections.set(tabId, setTimeout(async () => {
    pendingInjections.delete(tabId);

    // Skip if SDK is already active (SPA navigation — don't kill a live session)
    if (await isSDKAlreadyActive(tabId)) return;

    chrome.storage.local.get(
      ['serverUrl', 'optAutoContext', 'optTts', 'optDebug', 'context', 'autoInject'],
      (data) => {
        if (!data.autoInject) return;

        const params = buildInjectionParams(data);
        if (!params) return;

        injectIntoTab(tabId, params.scriptUrl, params.initCode)
          .then(() => injectNbtFunctions(tabId, params.httpBase, tab.url))
          .catch(() => {});
      }
    );
  }, 300));
});

// Clean up debounce timers when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (pendingInjections.has(tabId)) {
    clearTimeout(pendingInjections.get(tabId));
    pendingInjections.delete(tabId);
  }
});
