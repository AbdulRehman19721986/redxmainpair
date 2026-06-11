/**
 * index.js – REDXMAINPAIR Server
 * Routes:
 *   GET /       → pair.html  (single page: pair code + QR toggle)
 *   GET /code   → pair.js    (pair code → REDXBOT302~base64 sent to WhatsApp)
 *   GET /qr     → qr.js      (QR scan   → MEGA session ID sent to WhatsApp)
 */

import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

import pairRouter from './pair.js';
import qrRouter   from './qr.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT = process.env.PORT || 8000;

import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

/* ✅ CORS */
app.use(cors({
    origin:         '*',
    methods:        ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* ✅ ROUTES */
app.use('/code', pairRouter);
app.use('/qr',   qrRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 REDXBOT302 Pair Server running on http://localhost:${PORT}`);
});

export default app;
