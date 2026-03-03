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
    DisconnectReason
} from '@whiskeysockets/baileys';
import uploadToPastebin from './Paste.js';
import uploadToMega from './mega.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 60000;

const MESSAGE = `
*SESSION GENERATED SUCCESSFULLY* ✅

*Gɪᴠᴇ ᴀ ꜱᴛᴀʀ ᴛᴏ ʀᴇᴘᴏ ꜰᴏʀ ᴄᴏᴜʀᴀɢᴇ* 🌟
https://github.com/GlobalTechInfo/MEGA-MD

*Sᴜᴘᴘᴏʀᴛ Gʀᴏᴜᴘ ꜰᴏʀ ϙᴜᴇʀʏ* 💭
https://t.me/Global_TechInfo
https://whatsapp.com/channel/0029VagJIAr3bbVBCpEkAM07

*Yᴏᴜ-ᴛᴜʙᴇ ᴛᴜᴛᴏʀɪᴀʟꜱ* 🪄 
https://youtube.com/@GlobalTechInfo

*MEGA-MD--WHATSAPP* 🥀
`;

async function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        await fs.remove(FilePath);
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

// Shared session handler for both QR and number pairing
async function handlePairing(req, res, method) {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./sessions/session_${sessionId}`;
    if (!fs.existsSync('./sessions')) await fs.mkdir('./sessions', { recursive: true });

    let qrGenerated = false;
    let sessionCompleted = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;
    let isCleaningUp = false;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;
        console.log(`🧹 Cleaning up session ${sessionId} - Reason: ${reason}`);

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {}
            currentSocket = null;
        }
        setTimeout(async () => {
            await removeFile(dirs);
        }, 5000);
    }

    async function initiateSession(phoneNumber = null) {
        if (sessionCompleted || isCleaningUp) return;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ error: 'Connection failed after multiple attempts' });
            }
            await cleanup('max_reconnects');
            return;
        }

        if (!fs.existsSync(dirs)) await fs.mkdir(dirs, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 3,
            });

            const sock = currentSocket;

            // For number pairing, request code immediately after socket creation
            if (method === 'pair' && phoneNumber) {
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.send({
                                pairingCode: formattedCode,
                                message: `Your pairing code is: ${formattedCode}. Enter it in WhatsApp.`
                            });
                        }
                    } catch (err) {
                        console.error('Pairing code error:', err);
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(500).send({ error: 'Failed to generate pairing code' });
                        }
                        await cleanup('pairing_error');
                    }
                }, 1000);
            }

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent || sessionCompleted || isCleaningUp || method === 'pair') return;
                qrGenerated = true;
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' });
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.send({
                            qr: qrDataURL,
                            message: 'QR Code Generated! Scan with WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                        console.log('📱 QR Code sent to client');
                    }
                } catch (err) {
                    console.error('Error generating QR code:', err);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(500).send({ error: 'Failed to generate QR code' });
                    }
                    await cleanup('qr_error');
                }
            };

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, qr, isNewLogin } = update;

                if (qr && method === 'qr') {
                    await handleQRCode(qr);
                }

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            let uploadResult;
                            if (method === 'qr') {
                                console.log('📄 Uploading to Pastebin...');
                                uploadResult = await uploadToPastebin(credsFile, 'creds.json', 'json', '1');
                            } else {
                                console.log('📄 Uploading to Mega...');
                                uploadResult = await uploadToMega(credsFile, `creds_${sessionId}.json`);
                            }
                            console.log('✅ Session uploaded:', uploadResult);

                            const userJid = Object.keys(sock.authState.creds.me || {}).length > 0
                                ? jidNormalizedUser(sock.authState.creds.me.id)
                                : null;

                            if (userJid) {
                                const msg = await sock.sendMessage(userJid, { text: uploadResult });
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

                if (isNewLogin) console.log('🔐 New login via QR code');

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        await cleanup('already_complete');
                        return;
                    }
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('❌ Logged out or invalid session');
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).send({ error: 'Invalid QR scan or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (qrGenerated && !sessionCompleted && method === 'qr') {
                        reconnectAttempts++;
                        console.log(`🔁 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
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
                    console.log('⏰ Timeout');
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).send({ error: 'Session timeout' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error('❌ Error initializing session:', err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ error: 'Service Unavailable' });
            }
            await cleanup('init_error');
        }
    }

    // For QR method, no phone number needed
    if (method === 'qr') {
        await initiateSession();
    } else {
        // For pair method, expect a phone number in query
        const phoneNumber = req.query.number;
        if (!phoneNumber) {
            return res.status(400).send({ error: 'Missing phone number' });
        }
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        if (cleanNumber.length < 10 || cleanNumber.length > 15) {
            return res.status(400).send({ error: 'Invalid phone number format' });
        }
        await initiateSession(cleanNumber);
    }
}

// QR route (existing)
router.get('/', (req, res) => handlePairing(req, res, 'qr'));

// Number pairing route
router.get('/pair', (req, res) => handlePairing(req, res, 'pair'));

// Cleanup old sessions periodically
setInterval(async () => {
    try {
        if (!fs.existsSync('./sessions')) return;
        const sessions = await fs.readdir('./sessions');
        const now = Date.now();
        for (const session of sessions) {
            const sessionPath = `./sessions/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                if (now - stats.mtimeMs > 300000) { // 5 minutes
                    console.log(`🗑️ Removing old session: ${session}`);
                    await fs.remove(sessionPath);
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error('Error in cleanup interval:', e);
    }
}, 60000);

process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, cleaning up...');
    try { await fs.remove('./sessions'); } catch (e) {}
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received, cleaning up...');
    try { await fs.remove('./sessions'); } catch (e) {}
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    const ignore = [
        "conflict", "not-authorized", "Socket connection timeout",
        "rate-overlimit", "Connection Closed", "Timed Out",
        "Value not found", "Stream Errored", "Stream Errored (restart required)",
        "statusCode: 515", "statusCode: 503"
    ];
    if (!ignore.some(x => e.includes(x))) {
        console.log('Caught exception:', err);
    }
});

export default router;
