import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

import qrRouter from './qr.js';
import pairRouter from './pair.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ─── HEALTH CHECK (keep-alive target) ────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'alive', time: new Date().toISOString() });
});

app.use('/qr', qrRouter);
app.use('/code', pairRouter);

app.use('/pair', async (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});
app.use('/qrpage', (req, res) => {
    res.sendFile(path.join(__dirname, 'qr.html'));
});
app.use('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.listen(PORT, () => {
    console.log(`YouTube: @rootmindtech\nGitHub: @rootmindtech\nServer running on http://localhost:${PORT}`);
    startKeepAlive();
});

// ─── KEEP-ALIVE: self-ping every 14 minutes ───────────────────────────────────
// Render free tier sleeps after 15 min of inactivity.
// This pings /health every 14 min to stay awake forever.
function startKeepAlive() {
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || null;
    const interval = 14 * 60 * 1000; // 14 minutes

    if (RENDER_URL) {
        console.log(`🔁 Keep-alive enabled → pinging ${RENDER_URL}/health every 14 min`);
        setInterval(() => pingURL(`${RENDER_URL}/health`), interval);
    } else {
        // Fallback: ping localhost
        console.log(`🔁 Keep-alive → pinging localhost:${PORT}/health every 14 min`);
        setInterval(() => pingURL(`http://localhost:${PORT}/health`), interval);
    }
}

function pingURL(url) {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
        console.log(`✅ Keep-alive [${res.statusCode}] @ ${new Date().toISOString()}`);
    }).on('error', (err) => {
        console.error(`⚠️  Keep-alive ping failed: ${err.message}`);
    });
}

export default app;
