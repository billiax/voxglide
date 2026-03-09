// Fetch script URL (bypasses CSP/mixed content) and inject code into page
async function injectIntoTab(tabId, scriptUrl, code) {
  let combinedCode = '';

  // Fetch external script if URL provided (extension context bypasses mixed content)
  if (scriptUrl) {
    const response = await fetch(scriptUrl);
    if (!response.ok) throw new Error(`Failed to fetch ${scriptUrl}: ${response.status}`);
    combinedCode = await response.text();
  }

  // Append user code
  if (code) {
    combinedCode += '\n;\n' + code;
  }

  if (!combinedCode) return;

  // Inject as inline code — no external script tags, no CSP issues
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (code) => { new Function(code)(); },
    args: [combinedCode],
  });
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'inject') {
    injectIntoTab(msg.tabId, msg.scriptUrl, msg.code)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

// Auto-inject on every page load when enabled
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !/^https?:\/\//.test(tab.url)) return;

  chrome.storage.local.get(['scriptUrl', 'injectCode', 'autoInject'], (data) => {
    if (!data.autoInject) return;
    if (!data.scriptUrl && !data.injectCode) return;

    injectIntoTab(tabId, data.scriptUrl || '', data.injectCode || '').catch(() => {});
  });
});
