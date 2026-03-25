import http from 'http';
import fs from 'fs';
import path from 'path';
import { ALLOWED_ORIGINS } from './config.js';
import { trackedSessions } from './state.js';
import { matchUrlPattern } from './url-match.js';

// Static file serving for SDK dist
const distDir = path.resolve(import.meta.dirname || __dirname, '..', 'dist');
const adminDir = path.resolve(import.meta.dirname || __dirname, 'admin');
const examplesDir = path.resolve(import.meta.dirname || __dirname, '..', 'examples');
const functionsDir = path.resolve(
  process.env.FUNCTIONS_DIR || path.join(import.meta.dirname || __dirname, 'functions'),
);

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

export function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes('*')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

export function setCorsHeaders(res: http.ServerResponse, origin?: string): void {
  const allowedOrigin = origin && isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning');
}

// ── Helpers ──

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function ensureFunctionsDir(): void {
  if (!fs.existsSync(functionsDir)) {
    fs.mkdirSync(functionsDir, { recursive: true });
  }
  const manifestPath = path.join(functionsDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify({ functions: [] }, null, 2));
  }
}

interface ManifestEntry {
  name: string;
  description: string;
  match: string;
  script: string;
  source: 'manual' | 'build-mode';
  generatedAt?: number;
  sourceUrl?: string;
}

interface Manifest {
  functions: ManifestEntry[];
}

function readManifest(): Manifest {
  ensureFunctionsDir();
  const raw = fs.readFileSync(path.join(functionsDir, 'manifest.json'), 'utf-8');
  return JSON.parse(raw);
}

function writeManifest(manifest: Manifest): void {
  fs.writeFileSync(
    path.join(functionsDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

// ── Functions API ──

async function handleFunctionsApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = req.url || '';

  // GET /api/functions — list functions (optionally filtered by ?url=)
  if (url.startsWith('/api/functions') && !url.startsWith('/api/functions/') && req.method === 'GET') {
    const manifest = readManifest();
    const parsed = new URL(url, 'http://localhost');

    // Filter by URL if provided
    const filterUrl = parsed.searchParams.get('url');
    const filtered = filterUrl
      ? manifest.functions.filter((f) => matchUrlPattern(f.match, filterUrl))
      : manifest.functions;

    // If ?bundle=true, return a single JS bundle with all matching function code
    if (parsed.searchParams.get('bundle') === 'true') {
      const chunks: string[] = [];

      // Include shared helpers if the file exists
      const helpersPath = path.join(functionsDir, '_helpers.js');
      try {
        chunks.push(fs.readFileSync(helpersPath, 'utf-8'));
      } catch {
        // No helpers file — that's fine
      }

      chunks.push('window.nbt_functions = window.nbt_functions || {};');
      for (const entry of filtered) {
        const filePath = path.join(functionsDir, entry.script);
        try {
          chunks.push(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          // Skip missing files
        }
      }
      chunks.push("window.dispatchEvent(new CustomEvent('voxglide:functions-changed'));");
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(chunks.join('\n\n'));
      return true;
    }

    jsonResponse(res, 200, { functions: filtered });
    return true;
  }

  // POST /api/functions — save a new function
  if (url === '/api/functions' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const { name, code, description, match, source, sourceUrl } = body as {
      name: string; code: string; description?: string; match?: string;
      source?: 'manual' | 'build-mode'; sourceUrl?: string;
    };

    if (!name || !code) {
      jsonResponse(res, 400, { error: 'name and code are required' });
      return true;
    }

    // Sanitize name for filesystem
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeName}.js`;
    const filePath = path.join(functionsDir, fileName);

    ensureFunctionsDir();
    fs.writeFileSync(filePath, code);

    // Update manifest
    const manifest = readManifest();
    const existing = manifest.functions.findIndex(f => f.name === safeName);
    const entry: ManifestEntry = {
      name: safeName,
      description: description || '',
      match: match || '*',
      script: fileName,
      source: source || 'build-mode',
      generatedAt: Date.now(),
      sourceUrl,
    };

    if (existing >= 0) {
      manifest.functions[existing] = entry;
    } else {
      manifest.functions.push(entry);
    }
    writeManifest(manifest);

    console.log(`[voxglide] Function saved: ${safeName} (${fileName})`);
    jsonResponse(res, 200, { success: true, name: safeName, script: fileName });
    return true;
  }

  // DELETE /api/functions/:name — remove a function
  if (url.startsWith('/api/functions/') && req.method === 'DELETE') {
    const name = url.slice('/api/functions/'.length);
    if (!name) {
      jsonResponse(res, 400, { error: 'function name required' });
      return true;
    }

    const manifest = readManifest();
    const entry = manifest.functions.find(f => f.name === name);
    if (!entry) {
      jsonResponse(res, 404, { error: `Function "${name}" not found` });
      return true;
    }

    // Remove file
    const filePath = path.join(functionsDir, entry.script);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Update manifest
    manifest.functions = manifest.functions.filter(f => f.name !== name);
    writeManifest(manifest);

    console.log(`[voxglide] Function deleted: ${name}`);
    jsonResponse(res, 200, { success: true, name });
    return true;
  }

  return false;
}

// ── Main request handler ──

const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  setCorsHeaders(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: trackedSessions.size }));
    return;
  }

  // Functions API (CRUD)
  try {
    if (req.url?.startsWith('/api/functions') && await handleFunctionsApi(req, res)) {
      return;
    }
  } catch (err: any) {
    jsonResponse(res, 500, { error: err.message });
    return;
  }

  // Serve admin dashboard at /admin and /admin/*
  if (req.url === '/admin') {
    try {
      const html = fs.readFileSync(path.join(adminDir, 'index.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Admin page not found');
    }
    return;
  }

  if (req.url?.startsWith('/admin/')) {
    const relPath = req.url.slice('/admin/'.length);
    const filePath = path.join(adminDir, relPath);
    const ext = path.extname(filePath);

    // Prevent directory traversal and check MIME type
    if (!filePath.startsWith(adminDir) || !MIME_TYPES[ext]) {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // Serve nbt_functions files from /sdk/functions/
  // Check server/functions first (generated), then examples/ (static)
  if (req.url?.startsWith('/sdk/functions/')) {
    const subPath = req.url.slice('/sdk/functions/'.length);

    for (const dir of [functionsDir, examplesDir]) {
      const filePath = path.join(dir, subPath);
      if (!filePath.startsWith(dir)) continue; // directory traversal

      const ext = path.extname(filePath);
      const contentType = ext === '.json' ? 'application/json' : MIME_TYPES[ext];
      if (!contentType) continue;

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(content);
        return;
      } catch {
        continue; // try next directory
      }
    }

    res.writeHead(404);
    res.end();
    return;
  }

  // Serve SDK files from /sdk/ (no-cache so dev rebuilds are always picked up)
  if (req.url?.startsWith('/sdk/')) {
    const fileName = path.basename(req.url);
    const filePath = path.join(distDir, fileName);
    const ext = path.extname(fileName);

    // Prevent directory traversal
    if (!filePath.startsWith(distDir) || !MIME_TYPES[ext]) {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext],
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  res.writeHead(404);
  res.end();
};

export const httpServer = http.createServer(requestHandler);
