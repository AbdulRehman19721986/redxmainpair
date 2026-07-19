/**
 * qr.js – QR code pairing route
 * GET /qr
 * → returns { qr: <dataURL>, instructions: [...] }
 * → on connect: encodes creds as REDXBOT302~<base64> → sends to WhatsApp
 */

import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { sendSuccessCard } from './lib/successCard.js';

const router = express.Router();

function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        fs.rmSync(filePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs      = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync('./qr_sessions')) fs.mkdirSync('./qr_sessions', { recursive: true });
    removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let responseSent  = false;

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'fatal' }).child({ level: 'fatal' }),
                    ),
                },
                printQRInTerminal:              false,
                logger:                         pino({ level: 'fatal' }).child({ level: 'fatal' }),
                browser:                        Browsers.windows('Chrome'),
                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs:          60000,
                connectTimeoutMs:               60000,
                keepAliveIntervalMs:            30000,
                retryRequestDelayMs:            250,
                maxRetries:                     5,
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, qr } = update;

                if (qr && !responseSent) {
                    console.log('🟢 QR Code Generated!');
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: 'M',
                            type:    'image/png',
                            quality: 0.92,
                            margin:  1,
                            color:   { dark: '#000000', light: '#FFFFFF' },
                        });
                        if (!responseSent) {
                            responseSent = true;
                            res.send({
                                qr: qrDataURL,
                                message: 'QR Code Generated! Scan with your WhatsApp app.',
                                instructions: [
                                    '1. Open WhatsApp on your phone',
                                    '2. Go to Settings > Linked Devices',
                                    '3. Tap "Link a Device"',
                                    '4. Scan the QR code above',
                                ],
                            });
                        }
                    } catch (qrErr) {
                        console.error('QR error:', qrErr);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ code: 'Failed to generate QR code' });
                        }
                    }
                }

                if (connection === 'open') {
                    console.log('✅ QR scan connected! Sending session...');
                    try {
                        // Wait for creds to be fully saved
                        await delay(3000);

                        const credsPath   = dirs + '/creds.json';
                        const credsData   = fs.readFileSync(credsPath, 'utf-8');
                        const base64Creds = Buffer.from(credsData).toString('base64');
                        const sessionStr  = `REDXBOT302~${base64Creds}`;

                        const userJid = jidNormalizedUser(sock.authState.creds.me?.id || '');
                        if (!userJid) throw new Error('Could not resolve user JID');

                        // 1️⃣ Send session string
                        await sock.sendMessage(userJid, { text: sessionStr });
                        console.log('📄 Session ID sent to WhatsApp');

                        // 2️⃣ Brief pause
                        await delay(2000);

                        // 3️⃣ Send branded success card
                        await sendSuccessCard(sock, userJid);

                        // 4️⃣ Cleanup
                        await delay(1000);
                        removeFile(dirs);
                        console.log('🧹 Session cleaned up');
                        await delay(2000);
                        process.exit(0);

                    } catch (err) {
                        console.error('❌ Session send error:', err);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                if (isNewLogin) console.log('🔐 New login via QR');

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log('❌ Logged out. New QR needed.');
                    } else {
                        console.log('🔁 Connection closed — restarting...');
                        initiateSession();
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

            // Timeout if QR not scanned in 30s
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    removeFile(dirs);
                    setTimeout(() => process.exit(1), 2000);
                }
            }, 30000);

        } catch (err) {
            console.error('Error initializing QR session:', err);
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
            removeFile(dirs);
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    if (['conflict', 'not-authorized', 'Socket connection timeout', 'rate-overlimit',
         'Connection Closed', 'Timed Out', 'Value not found', 'Stream Errored',
         'statusCode: 515', 'statusCode: 503'].some(x => e.includes(x))) return;
    console.log('Caught exception:', err);
    process.exit(1);
});

export default router;
