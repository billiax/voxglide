import { PORT, ALLOWED_ORIGINS, provider } from './config.js';
import { httpServer } from './http.js';
import { initWebSockets } from './websocket.js';

initWebSockets(httpServer);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[voxglide] Listening on ws://0.0.0.0:${PORT}`);
  console.log(`[voxglide] SDK: http://0.0.0.0:${PORT}/sdk/voice-sdk.iife.js`);
  console.log(`[voxglide] Admin: http://0.0.0.0:${PORT}/admin`);
  console.log(`[voxglide] Provider: ${provider.name} (${provider.model})`);
  console.log(`[voxglide] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
