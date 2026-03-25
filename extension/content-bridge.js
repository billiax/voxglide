/**
 * Content script bridge for VoxGlide build mode.
 * Relays fetch requests from the MAIN world (SDK) to the background
 * service worker, which can make cross-origin requests without CORS.
 *
 * Flow: SDK (postMessage) → this script (chrome.runtime) → background.js → fetch
 */

function isBridgeAlive() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.sendMessage);
  } catch {
    return false;
  }
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  // Respond to ping (SDK checking if bridge is available)
  if (event.data?.type === 'voxglide:bridge-ping') {
    if (isBridgeAlive()) {
      window.postMessage({ type: 'voxglide:bridge-ready' }, '*');
    }
    return;
  }

  if (event.data?.type !== 'voxglide:build-fetch') return;

  const { requestId, url, options } = event.data;

  if (!isBridgeAlive()) {
    window.postMessage({
      type: 'voxglide:build-fetch-response',
      requestId,
      ok: false,
      status: 0,
      body: 'Extension context invalidated — reload the page',
    }, '*');
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'buildFetch',
      url,
      options,
    });

    window.postMessage({
      type: 'voxglide:build-fetch-response',
      requestId,
      ok: response.ok,
      status: response.status,
      body: response.body,
    }, '*');
  } catch (err) {
    window.postMessage({
      type: 'voxglide:build-fetch-response',
      requestId,
      ok: false,
      status: 0,
      body: err.message || 'Extension bridge error',
    }, '*');
  }
});

// Signal to the SDK that the bridge is available
if (isBridgeAlive()) {
  window.postMessage({ type: 'voxglide:bridge-ready' }, '*');
}
