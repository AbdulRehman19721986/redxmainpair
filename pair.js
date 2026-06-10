/**
 * pair.js – Phone-number pairing route for Baileys 7 rc13
 *
 * GET /code?number=923XXXXXXXXX
 *
 * Returns immediately: { code: "XXXX-XXXX", sessionKey: "abc123" }
 *
 * After WhatsApp confirms:
 *   1. Uploads creds.json → Pastebin
 *   2. Generates QR code of raw Pastebin URL
 *   3. Sends QR image + session ID → user's WhatsApp
 *   4. Stores result in SessionStore → frontend polls /session-status?key=…
 */

import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import QRCode from 'qrcode';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason,
} from '@whiskeysockets/baileys';
import { uploadFile as uploadToPastebin } from './Paste.js';
import { setSession } from './SessionStore.js';

const router = express.Router();

const MAX_RECONNECT   = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;   // 5 min
const CLEANUP_DELAY   = 5_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKey() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function removeDir(p) {
    try { if (fs.existsSync(p)) await fs.remove(p); } catch {}
}

async function getBaileysVersion() {
    try { return (await fetchLatestBaileysVersion()).version; } catch {}
    return [2, 3000, 1023506770]; // fallback
}

async function makeSessionQR(pasteUrl) {
    return QRCode.toDataURL(pasteUrl, {
        errorCorrectionLevel: 'H',
        width: 320,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
    });
}

// ─── Route ───────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    let raw = req.query.number;
    if (!raw) return res.status(400).json({ error: 'Phone number required.' });

    raw = raw.replace(/[^0-9]/g, '');
    const phone = pn('+' + raw);
    if (!phone.isValid()) return res.status(400).json({ error: 'Invalid phone number.' });
    const num = phone.getNumber('e164').replace('+', '');

    const sessionKey = makeKey();
    const sessionDir = `./sessions/pair_${sessionKey}`;

    setSession(sessionKey, { status: 'pending', num });

    let pairingCodeSent = false;
    let sessionCompleted = false;
    let isCleaningUp    = false;
    let responseSent    = false;
    let reconnects      = 0;
    let sock            = null;
    let timeoutHandle   = null;

    // ── Cleanup ──
    async function cleanup(reason) {
        if (isCleaningUp) return;
        isCleaningUp = true;
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        if (sock) {
            try { sock.ev.removeAllListeners(); await sock.end(); } catch {}
            sock = null;
        }
        setTimeout(() => removeDir(sessionDir), CLEANUP_DELAY);
    }

    // ── Session handler (called after 'open') ──
    async function handleSessionComplete() {
        const credsFile = `${sessionDir}/creds.json`;
        if (!fs.existsSync(credsFile)) return;

        // 1. Upload creds → Pastebin
        const pasteUrl = await uploadToPastebin(credsFile, `redxbot_${num}.json`);
        const pasteId  = pasteUrl.split('/').pop();          // raw paste ID

        // 2. Generate QR of Pastebin URL
        const sessionQr = await makeSessionQR(pasteUrl);

        // 3. Persist to store
        setSession(sessionKey, {
            status:     'complete',
            pasteUrl,
            pasteId,
            sessionQr,                                       // data:image/png;base64,…
        });

        // 4. Send QR image + text to user's WhatsApp
        const userJid   = jidNormalizedUser(`${num}@s.whatsapp.net`);
        const qrBuffer  = Buffer.from(sessionQr.split(',')[1], 'base64');

        await sock.sendMessage(userJid, {
            image:   qrBuffer,
            caption: `*🔥 SESSION READY*\n\n*Paste ID:* \`${pasteId}\`\n*Raw URL:* ${pasteUrl}\n\nScan QR above or use:\nSESSION_ID=${pasteId}`,
        });

        const infoMsg = `*✅ REDXBOT302 – Session Generated*\n\n*Your Number:* +${num}\n\n*📌 Session ID:* \`${pasteId}\`\n*🔗 Raw URL:* ${pasteUrl}\n\n*Instructions:*\nSet in your bot:\n\`\`\`SESSION_ID=${pasteId}\`\`\`\n\n_Powered by redxbot302.vercel.app_`;
        await sock.sendMessage(userJid, { text: infoMsg });
    }

    // ── Main session initiator ──
    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) return;

        if (reconnects >= MAX_RECONNECT) {
            setSession(sessionKey, { status: 'failed', error: 'Max reconnect attempts reached' });
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ error: 'Connection failed after multiple attempts.' });
            }
            return cleanup('max_reconnects');
        }

        try {
            await fs.ensureDir(sessionDir);
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            const version = await getBaileysVersion();

            if (sock) { try { sock.ev.removeAllListeners(); await sock.end(); } catch {} }

            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'fatal' }).child({ level: 'fatal' })
                    ),
                },
                logger:                      pino({ level: 'silent' }),
                browser:                     Browsers.ubuntu('Chrome'),
                printQRInTerminal:           false,
                markOnlineOnConnect:         false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs:       60_000,
                connectTimeoutMs:            60_000,
                keepAliveIntervalMs:         30_000,
                retryRequestDelayMs:         250,
                maxRetries:                  3,
            });

            const _sock = sock;

            _sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;
                    try {
                        await handleSessionComplete();
                    } catch (err) {
                        console.error('❌ Session upload error:', err.message);
                        setSession(sessionKey, { status: 'failed', error: err.message });
                    } finally {
                        await delay(1000);
                        await cleanup('session_complete');
                    }
                }

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) { await cleanup('already_done'); return; }
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code === DisconnectReason.loggedOut || code === 401) {
                        setSession(sessionKey, { status: 'failed', error: 'Invalid pairing code.' });
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).json({ error: 'Invalid pairing code or session expired.' });
                        }
                        await cleanup('logged_out');
                    } else if (pairingCodeSent && !sessionCompleted) {
                        reconnects++;
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            _sock.ev.on('creds.update', saveCreds);

            // Request pairing code
            if (!_sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
                await delay(1500);
                try {
                    pairingCodeSent = true;
                    let code = await _sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({ code, sessionKey });
                    }
                } catch (err) {
                    pairingCodeSent = false;
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(503).json({ error: 'Failed to get pairing code. Try again.' });
                    }
                    await cleanup('pairing_code_error');
                }
            }

            // Session timeout
            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    setSession(sessionKey, { status: 'timeout' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ error: 'Pairing timeout. Please try again.' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('❌ Init error:', err.message);
            setSession(sessionKey, { status: 'failed', error: err.message });
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ error: 'Service unavailable. Try again.' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// ─── Stale-session cleanup (every 10 min) ────────────────────────────────────
setInterval(async () => {
    try {
        const base = './sessions';
        if (!fs.existsSync(base)) return;
        const now  = Date.now();
        for (const name of await fs.readdir(base)) {
            try {
                const stats = await fs.stat(`${base}/${name}`);
                if (now - stats.mtimeMs > 10 * 60_000) await fs.remove(`${base}/${name}`);
            } catch {}
        }
    } catch {}
}, 10 * 60_000);

// ─── Process guards ───────────────────────────────────────────────────────────
const IGNORE = ['conflict','not-authorized','Socket connection timeout','rate-overlimit',
    'Connection Closed','Timed Out','Value not found','Stream Errored','statusCode: 515','statusCode: 503'];

process.on('uncaughtException', err => {
    const s = String(err);
    if (!IGNORE.some(x => s.includes(x))) console.error('Unhandled exception:', err);
});

process.on('SIGTERM', async () => { try { await fs.remove('./sessions'); } catch {} process.exit(0); });
process.on('SIGINT',  async () => { try { await fs.remove('./sessions'); } catch {} process.exit(0); });

export default router;
