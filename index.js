/**
 * index.js – REDXPAIR pairing server entry point
 * Serves HTML pages + mounts pair/QR API routers.
 */

import express  from 'express';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import pairRouter from './pair.js';
import qrRouter   from './qr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── HTML pages ────────────────────────────────────────
app.get('/',       (_req, res) => res.sendFile(join(__dirname, 'main.html')));
app.get('/pair',   (_req, res) => res.sendFile(join(__dirname, 'pair.html')));
app.get('/qrpage', (_req, res) => res.sendFile(join(__dirname, 'qr.html')));

// ── API routes ────────────────────────────────────────
app.use('/code', pairRouter);   // GET /code?number=923...
app.use('/qr',   qrRouter);     // GET /qr

// ── Health check (keep-alive / Render ping) ───────────
app.get('/ping', (_req, res) => res.send('pong'));

// ── Start ─────────────────────────────────────────────
app.listen(PORT, () =>
    console.log(`🌐 REDXPAIR server running on port ${PORT}`)
);
