const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const router = express.Router();

function removeFolder(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    const tempDir = path.join(__dirname, 'temp', id);
    const phoneNumber = (req.query.number || '').replace(/\D/g, '');

    if (!phoneNumber) {
        return res.status(400).json({ error: "Please provide a valid phone number" });
    }

    let responseSent = false;

    async function createSocketSession() {
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        const logger = pino({ level: "fatal" }).child({ level: "fatal" });

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
            logger,
            syncFullHistory: false,
            browser: Browsers.macOS("Safari")
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                await delay(5000);
                try {
                    const credsPath = path.join(tempDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const sessionData = fs.readFileSync(credsPath, 'utf8');
                        const base64 = Buffer.from(sessionData).toString('base64');
                        const sessionId = "REDXBOT~" + base64;

                        await sock.sendMessage(sock.user.id, { text: sessionId });

                        const successMsg = {
                            text: `🚀 *REDXBOT Session Created!*\n\n` +
                                  `▸ *Never share* your session ID\n` +
                                  `▸ Join our WhatsApp Channel\n` +
                                  `▸ Report bugs on GitHub\n\n` +
                                  `_Powered by REDXBOT_`,
                            contextInfo: {
                                mentionedJid: [sock.user.id],
                                forwardingScore: 1000,
                                isForwarded: true
                            }
                        };
                        await sock.sendMessage(sock.user.id, successMsg);
                    }
                } catch (err) {
                    console.error("❌ Session Error:", err.message);
                } finally {
                    await delay(1000);
                    await sock.ws.close();
                    removeFolder(tempDir);
                    console.log(`✅ Session completed for ${sock.user.id}`);
                }

            } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                console.log("🔁 Reconnecting...");
                await delay(10);
                createSocketSession();
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            try {
                const pairingCode = await sock.requestPairingCode(phoneNumber, "REDXBOT123");
                if (!responseSent) {
                    responseSent = true;
                    return res.json({ code: pairingCode });
                }
            } catch (err) {
                if (!responseSent) {
                    responseSent = true;
                    return res.status(500).json({ error: "Failed to request pairing code: " + err.message });
                }
            }
        }
    }

    try {
        await createSocketSession();
    } catch (err) {
        console.error("🚨 Fatal Error:", err.message);
        removeFolder(tempDir);
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ error: "Service Unavailable. Try again later." });
        }
    }
});

module.exports = router;