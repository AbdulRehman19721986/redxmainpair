/**
 * qr.js – WhatsApp QR pairing route (Baileys rc13)
 * GET /qr
 * → returns { qr: "<dataURL>", message, instructions }
 * → on connect: uploads creds → sends REDXBOT302/SESSION_xxx to WhatsApp
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
import uploadToPastebin from './Paste.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT        = 60000;

const MESSAGE = `
*SESSION GENERATED SUCCESSFULLY* ✅

*REDXBOT302 – WhatsApp Bot* 🤖
https://github.com/AbdulRehmanRajpoot/REDXBOT302

*Support Group* 💭
https://whatsapp.com/channel/0029VagJIAr3bbVBCpEkAM07

*Powered by RedXAI* 🔥
`;

async function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        await fs.remove(filePath);
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs      = `./qr_sessions/session_${sessionId}`;
    if (!fs.existsSync('./qr_sessions')) await fs.mkdir('./qr_sessions', { recursive: true });

    let qrGenerated       = false;
    let sessionCompleted  = false;
    let responseSent      = false;
    let reconnectAttempts = 0;
    let currentSocket     = null;
    let timeoutHandle     = null;
    let isCleaningUp      = false;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;
        console.log(`🧹 Cleanup session ${sessionId} – ${reason}`);
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        if (currentSocket) {
            try { currentSocket.ev.removeAllListeners(); await currentSocket.end(); } catch {}
            currentSocket = null;
        }
        setTimeout(() => removeFile(dirs), 5000);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) return;

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: 'Connection failed after multiple attempts' });
            }
            return cleanup('max_reconnects');
        }

        if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try { currentSocket.ev.removeAllListeners(); await currentSocket.end(); } catch {}
            }

            currentSocket = makeWASocket({
                version,
                logger:  pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                printQRInTerminal:              false,
                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs:          60000,
                connectTimeoutMs:               60000,
                keepAliveIntervalMs:            30000,
                retryRequestDelayMs:            250,
                maxRetries:                     3,
            });

            const sock = currentSocket;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp) return;
                qrGenerated = true;
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.send({
                            qr:      qrDataURL,
                            message: 'QR Code Generated! Scan with WhatsApp.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings → Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above',
                            ],
                        });
                        console.log('📱 QR sent to client');
                    }
                } catch (err) {
                    console.error('Error generating QR:', err);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                    await cleanup('qr_error');
                }
            };

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrGenerated && !sessionCompleted) await handleQRCode(qr);

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;
                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            console.log('📄 Uploading creds to Pastebin…');
                            const sessionStr = await uploadToPastebin(credsFile, 'creds.json', 'json', '1');
                            console.log('✅ Session ready:', sessionStr);

                            const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                                ? jidNormalizedUser(sock.authState.creds.me.id)
                                : null;

                            if (userJid) {
                                const msg = await sock.sendMessage(userJid, { text: sessionStr });
                                await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });
                            }
                            await delay(1000);
                        }
                    } catch (err) {
                        console.error('Error sending session:', err);
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) { await cleanup('already_complete'); return; }
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).send({ code: 'Invalid QR scan or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (qrGenerated && !sessionCompleted) {
                        reconnectAttempts++;
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).send({ code: 'QR generation timeout' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('❌ Init error:', err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: 'Service Unavailable' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// Stale session cleanup
setInterval(async () => {
    try {
        if (!fs.existsSync('./qr_sessions')) return;
        const now = Date.now();
        for (const s of await fs.readdir('./qr_sessions')) {
            try {
                const stats = await fs.stat(`./qr_sessions/${s}`);
                if (now - stats.mtimeMs > 300000) await fs.remove(`./qr_sessions/${s}`);
            } catch {}
        }
    } catch {}
}, 60000);

process.on('SIGTERM', async () => { try { await fs.remove('./qr_sessions'); } catch {} process.exit(0); });
process.on('SIGINT',  async () => { try { await fs.remove('./qr_sessions'); } catch {} process.exit(0); });

process.on('uncaughtException', (err) => {
    const e = String(err);
    const ignore = ['conflict','not-authorized','Socket connection timeout','rate-overlimit',
        'Connection Closed','Timed Out','Value not found','Stream Errored','statusCode: 515','statusCode: 503'];
    if (!ignore.some(x => e.includes(x))) console.log('Caught exception:', err);
});

export default router;
