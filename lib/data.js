/**
 * lib/data.js – loads datamain.txt (KEY=VALUE per line) into one DATA object.
 * Edit datamain.txt to change owner info / links / channel / image.
 * Every file that needs this stuff imports from here — no more hardcoded
 * copies scattered across pair.js / qr.js / html pages.
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

function loadData() {
    const filePath = join(__dirname, '..', 'datamain.txt');
    const out = {};
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx === -1) continue;
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            out[key] = val;
        }
    } catch (err) {
        console.error('⚠️  datamain.txt not found/readable, using fallback empty data:', err.message);
    }
    return out;
}

export const DATA = loadData();
