/**
 * qr.js – WhatsApp QR-code pairing route for Baileys 7 rc13
 *
 * GET /qr
 *
 * Returns immediately: { qr: "<dataURL>", sessionKey: "abc123" }
 *
 * After user scans and WhatsApp confirms:
 *   1. Uploads creds.json → Pastebin
 *   2. Generates session QR (encodes raw Pastebin URL)
 *   3. Sends QR image + session ID → user's WhatsApp
 *   4. Stores result → SessionStore for frontend polling
 */

import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import QRCode from 'qrcode';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    delay,
    DisconnectReason,
} from '@whiskeysockets/baileys';
import { uploadFile as uploadToPastebin } from './Paste.js';
import { setSession } from './SessionStore.js';

const router = express.Router();

const MAX_RECONNECT   = 3;
const SESSION_TIMEOUT = 60_000;  // 1 min to generate QR
const CLEANUP_DELAY   = 5_000;

function makeKey() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

async function removeDir(p) {
    try { if (fs.existsSync(p)) await fs.remove(p); } catch {}
}

async function getBaileysVersion() {
    try { return (await fetchLatestBaileysVersion()).version; } catch {}
    return [2, 3000, 1023506770];
}

async function makeSessionQR(pasteUrl) {
    return QRCode.toDataURL(pasteUrl, {
        errorCorrectionLevel: 'H',
        width: 320,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
    });
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    const sessionKey = makeKey();
    const sessionDir = `./sessions/qr_${sessionKey}`;

    setSession(sessionKey, { status: 'pending' });

    let qrSent          = false;
    let sessionComplete = false;
    let isCleaningUp    = false;
    let responseSent    = false;
    let reconnects      = 0;
    let sock            = null;
    let timeoutHandle   = null;

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

    async function handleSessionComplete() {
        const credsFile = `${sessionDir}/creds.json`;
        if (!fs.existsSync(credsFile)) return;

        // Upload creds → Pastebin
        const me = sock?.authState?.creds?.me;
        const numStr = me?.id ? jidNormalizedUser(me.id).split('@')[0] : 'unknown';

        const pasteUrl = await uploadToPastebin(credsFile, `redxbot_${numStr}.json`);
        const pasteId  = pasteUrl.split('/').pop();

        // Generate session QR from Pastebin URL
        const sessionQr = await makeSessionQR(pasteUrl);

        setSession(sessionKey, {
            status:  'complete',
            pasteUrl,
            pasteId,
            sessionQr,
            num: numStr,
        });

        // Deliver to WhatsApp
        const userJid = me?.id ? jidNormalizedUser(me.id) : null;
        if (userJid) {
            const qrBuffer = Buffer.from(sessionQr.split(',')[1], 'base64');
            await sock.sendMessage(userJid, {
                image:   qrBuffer,
                caption: `*🔥 SESSION READY*\n\n*Paste ID:* \`${pasteId}\`\n*Raw URL:* ${pasteUrl}\n\nScan QR above to load session.\nSESSION_ID=${pasteId}`,
            });
            await sock.sendMessage(userJid, {
                text: `*✅ REDXBOT302 – QR Session Generated*\n\n*Your Number:* +${numStr}\n\n*📌 Session ID:* \`${pasteId}\`\n*🔗 Raw URL:* ${pasteUrl}\n\n_Powered by redxbot302.vercel.app_`,
            });
        }
    }

    async function initiateSession() {
        if (sessionComplete || isCleaningUp) return;

        if (reconnects >= MAX_RECONNECT) {
            setSession(sessionKey, { status: 'failed', error: 'Max reconnects reached' });
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
                logger:                         pino({ level: 'silent' }),
                browser:                        Browsers.ubuntu('Chrome'),
                printQRInTerminal:              false,
                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs:          60_000,
                connectTimeoutMs:               60_000,
                keepAliveIntervalMs:            30_000,
                retryRequestDelayMs:            250,
                maxRetries:                     3,
            });

            const _sock = sock;

            const handleQR = async (qrRaw) => {
                if (qrSent || responseSent || sessionComplete || isCleaningUp) return;
                qrSent = true;
                try {
                    const qrDataUrl = await QRCode.toDataURL(qrRaw, { errorCorrectionLevel: 'M' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.json({
                            qr: qrDataUrl,
                            sessionKey,
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Settings → Linked Devices → Link a Device',
                                '3. Scan the QR code above',
                            ],
                        });
                    }
                } catch (err) {
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).json({ error: 'Failed to generate QR code.' });
                    }
                    await cleanup('qr_error');
                }
            };

            _sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrSent && !sessionComplete) await handleQR(qr);

                if (connection === 'open') {
                    if (sessionComplete) return;
                    sessionComplete = true;
                    try {
                        await handleSessionComplete();
                    } catch (err) {
                        console.error('❌ QR session upload error:', err.message);
                        setSession(sessionKey, { status: 'failed', error: err.message });
                    } finally {
                        await delay(1000);
                        await cleanup('session_complete');
                    }
                }

                if (connection === 'close') {
                    if (sessionComplete || isCleaningUp) { await cleanup('already_done'); return; }
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code === DisconnectReason.loggedOut || code === 401) {
                        setSession(sessionKey, { status: 'failed', error: 'QR scan rejected.' });
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).json({ error: 'QR scan rejected or session expired.' });
                        }
                        await cleanup('logged_out');
                    } else if (qrSent && !sessionComplete) {
                        reconnects++;
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            _sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionComplete && !isCleaningUp) {
                    setSession(sessionKey, { status: 'timeout' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ error: 'QR generation timeout.' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('❌ QR init error:', err.message);
            setSession(sessionKey, { status: 'failed', error: err.message });
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).json({ error: 'Service unavailable.' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// ─── Stale-session cleanup ───────────────────────────────────────────────────
setInterval(async () => {
    try {
        const base = './sessions';
        if (!fs.existsSync(base)) return;
        const now = Date.now();
        for (const name of await fs.readdir(base)) {
            try {
                const s = await fs.stat(`${base}/${name}`);
                if (now - s.mtimeMs > 10 * 60_000) await fs.remove(`${base}/${name}`);
            } catch {}
        }
    } catch {}
}, 10 * 60_000);

const IGNORE = ['conflict','not-authorized','Socket connection timeout','rate-overlimit',
    'Connection Closed','Timed Out','Value not found','Stream Errored','statusCode: 515','statusCode: 503'];

process.on('uncaughtException', err => {
    if (!IGNORE.some(x => String(err).includes(x))) console.error('Unhandled:', err);
});

export default router;
