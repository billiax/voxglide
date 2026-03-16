import http from 'http';
import fs from 'fs';
import path from 'path';
import { ALLOWED_ORIGINS } from './config.js';
import { trackedSessions } from './state.js';

// Static file serving for SDK dist
const distDir = path.resolve(import.meta.dirname || __dirname, '..', 'dist');
const adminDir = path.resolve(import.meta.dirname || __dirname, 'admin');
const examplesDir = path.resolve(import.meta.dirname || __dirname, '..', 'examples');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse) => {
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
  if (req.url?.startsWith('/sdk/functions/')) {
    const subPath = req.url.slice('/sdk/functions/'.length);
    const filePath = path.join(examplesDir, subPath);

    // Prevent directory traversal
    if (!filePath.startsWith(examplesDir)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const ext = path.extname(filePath);
    const contentType = ext === '.json' ? 'application/json' : MIME_TYPES[ext];
    if (!contentType) {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end();
    }
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
