/**
 * index.js – REDXMAINPAIR Server
 * Routes:
 *   GET /       → main.html
 *   GET /code   → pair.js  (pair code → session sent to WhatsApp)
 *   GET /qr     → qr.js    (QR scan  → session sent to WhatsApp)
 *   GET /pair   → pair.html
 *   GET /qrpage → qr.html
 *   GET /health → keep-alive
 */

import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

import pairRouter from './pair.js';
import qrRouter   from './qr.js';

const app       = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 8000;

import('events').then(m => { m.EventEmitter.defaultMaxListeners = 500; });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin',  process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/health', (_req, res) => res.json({ status: 'alive', time: new Date().toISOString(), version: '3.1.0' }));

app.use('/code',   pairRouter);
app.use('/qr',     qrRouter);

app.use('/pair',   (_req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.use('/qrpage', (_req, res) => res.sendFile(path.join(__dirname, 'qr.html')));
app.use('/',       (_req, res) => res.sendFile(path.join(__dirname, 'main.html')));

app.listen(PORT, () => {
    console.log(`🔥 REDXMAINPAIR v3.1 running on :${PORT}`);
    startKeepAlive();
});

function startKeepAlive() {
    const BASE     = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    const INTERVAL = 14 * 60 * 1000;
    console.log(`🔁 Keep-alive pinging ${BASE}/health every 14 min`);
    setInterval(() => {
        const mod = BASE.startsWith('https') ? https : http;
        mod.get(`${BASE}/health`, r => {
            console.log(`✅ Keep-alive [${r.statusCode}] @ ${new Date().toISOString()}`);
        }).on('error', e => console.error(`⚠️ Keep-alive failed: ${e.message}`));
    }, INTERVAL);
}

export default app;
