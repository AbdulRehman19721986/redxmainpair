/**
 * index.js – REDXMAINPAIR Backend Server
 *
 * Routes:
 *   GET /          → main.html (landing page)
 *   GET /code      → pair.js   (pairing code + Pastebin QR)
 *   GET /qr        → qr.js     (WhatsApp QR + Pastebin QR)
 *   GET /session-status?key=… → SessionStore lookup (for frontend polling)
 *   GET /health    → keep-alive probe
 */

import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

import pairRouter from './pair.js';
import qrRouter   from './qr.js';
import { getSession } from './SessionStore.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8000;

// Raise emitter limit for many concurrent sessions
import('events').then(m => { m.EventEmitter.defaultMaxListeners = 500; });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'alive', time: new Date().toISOString(), version: '3.0.0' });
});

// ─── Session Status (polling endpoint for frontend) ──────────────────────────
// Returns session state after pairing completes.
// Frontend polls every 3 s after receiving code/QR.
//
// Response shapes:
//   { status: 'pending' }
//   { status: 'complete', pasteId, pasteUrl, sessionQr }
//   { status: 'failed', error }
//   { status: 'timeout' }
//   { status: 'not_found' }
app.get('/session-status', (req, res) => {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'Missing key' });

    const data = getSession(key);
    if (!data) return res.json({ status: 'not_found' });

    // Never expose the full sessionQr over this endpoint unless complete
    const { status, pasteId, pasteUrl, sessionQr, error } = data;
    if (status === 'complete') {
        return res.json({ status, pasteId, pasteUrl, sessionQr });
    }
    return res.json({ status, ...(error ? { error } : {}) });
});

// ─── Core Routers ────────────────────────────────────────────────────────────
app.use('/code', pairRouter);
app.use('/qr',   qrRouter);

// ─── HTML Pages ───────────────────────────────────────────────────────────────
app.use('/pair',   (_req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.use('/qrpage', (_req, res) => res.sendFile(path.join(__dirname, 'qr.html')));
app.use('/',       (_req, res) => res.sendFile(path.join(__dirname, 'main.html')));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🔥 REDXMAINPAIR v3.0 running on :${PORT}`);
    console.log(`   Baileys: ^7.0.0-rc.13`);
    console.log(`   Session: Pastebin QR System`);
    startKeepAlive();
});

// ─── Keep-alive (Render free-tier stays awake) ────────────────────────────────
function startKeepAlive() {
    const BASE = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const INTERVAL = 14 * 60 * 1000;
    console.log(`🔁 Keep-alive → pinging ${BASE}/health every 14 min`);
    setInterval(() => pingURL(`${BASE}/health`), INTERVAL);
}

function pingURL(url) {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, r => {
        console.log(`✅ Keep-alive [${r.statusCode}] @ ${new Date().toISOString()}`);
    }).on('error', e => console.error(`⚠️  Keep-alive failed: ${e.message}`));
}

export default app;
