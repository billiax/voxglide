const scriptUrlInput = document.getElementById('scriptUrl');
const codeArea = document.getElementById('code');
const autoInjectToggle = document.getElementById('autoInject');
const injectBtn = document.getElementById('inject');
const statusEl = document.getElementById('status');

// Load saved state
chrome.storage.local.get(['scriptUrl', 'injectCode', 'autoInject'], (data) => {
  scriptUrlInput.value = data.scriptUrl || '';
  codeArea.value = data.injectCode || '';
  autoInjectToggle.checked = !!data.autoInject;
});

// Save on change
scriptUrlInput.addEventListener('input', () => {
  chrome.storage.local.set({ scriptUrl: scriptUrlInput.value });
});

codeArea.addEventListener('input', () => {
  chrome.storage.local.set({ injectCode: codeArea.value });
});

autoInjectToggle.addEventListener('change', () => {
  chrome.storage.local.set({ autoInject: autoInjectToggle.checked });
});

// Inject now button
injectBtn.addEventListener('click', () => {
  const scriptUrl = scriptUrlInput.value.trim();
  const code = codeArea.value.trim();
  if (!scriptUrl && !code) {
    statusEl.textContent = 'Nothing to inject';
    return;
  }

  statusEl.textContent = 'Injecting...';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.runtime.sendMessage(
      { action: 'inject', tabId: tabs[0].id, scriptUrl, code },
      (response) => {
        if (response?.success) {
          statusEl.textContent = 'Injected';
          setTimeout(() => { statusEl.textContent = ''; }, 2000);
        } else {
          statusEl.textContent = 'Error: ' + (response?.error || 'Unknown');
        }
      }
    );
  });
});
