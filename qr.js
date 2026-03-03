import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

router.get("/", async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    await removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

            let responseSent = false;

            const bot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" }),
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            bot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !responseSent) {
                    console.log("🟢 QR Code Generated!");
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: "M",
                            type: "image/png",
                            quality: 0.92,
                            margin: 1,
                            color: { dark: "#000000", light: "#FFFFFF" },
                        });

                        responseSent = true;
                        res.send({
                            qr: qrDataURL,
                            message: "Scan QR code with WhatsApp",
                            instructions: [
                                "1. Open WhatsApp on your phone",
                                "2. Go to Settings > Linked Devices",
                                '3. Tap "Link a Device"',
                                "4. Scan the QR code above",
                            ],
                        });
                    } catch (qrError) {
                        console.error("QR generation error:", qrError);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ error: "Failed to generate QR" });
                        }
                    }
                }

                if (connection === "open") {
                    console.log("✅ Connected! Processing session...");

                    // Small delay to ensure creds file is fully written
                    await delay(2000);

                    try {
                        const credsPath = `${dirs}/creds.json`;
                        if (!fs.existsSync(credsPath)) {
                            throw new Error("creds.json not found");
                        }

                        // Read creds file
                        const credsData = fs.readFileSync(credsPath, 'utf8');
                        // Validate JSON
                        JSON.parse(credsData); // throws if invalid

                        // Convert to base64 (no newlines)
                        const base64 = Buffer.from(credsData).toString('base64');

                        // Get user's JID to send the base64 string
                        const userJid = jidNormalizedUser(bot.authState.creds.me?.id || "");
                        if (userJid) {
                            await bot.sendMessage(userJid, {
                                text: `✅ *Your Base64 Session:*\n\n${base64}`,
                            });
                            console.log("📤 Base64 session sent to user.");
                        } else {
                            console.log("❌ Could not determine user JID");
                        }

                        console.log("🧹 Cleaning up...");
                        await delay(1000);
                        removeFile(dirs);
                        console.log("✅ Done. Exiting.");
                        await delay(2000);
                        process.exit(0);
                    } catch (err) {
                        console.error("❌ Error processing session:", err);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log("❌ Logged out. Please scan again.");
                    } else {
                        console.log("🔁 Connection closed – retrying...");
                        initiateSession();
                    }
                }
            });

            bot.ev.on("creds.update", saveCreds);

            // Timeout for QR generation
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ error: "QR generation timeout" });
                    removeFile(dirs);
                    setTimeout(() => process.exit(1), 2000);
                }
            }, 60000);
        } catch (err) {
            console.error("Init error:", err);
            if (!res.headersSent) {
                res.status(500).send({ error: "Service error" });
            }
            removeFile(dirs);
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

process.on("uncaughtException", (err) => {
    const msg = String(err);
    if (msg.includes("conflict") || msg.includes("not-authorized") ||
        msg.includes("timeout") || msg.includes("rate-overlimit") ||
        msg.includes("Connection Closed") || msg.includes("Stream Errored") ||
        msg.includes("statusCode: 515") || msg.includes("statusCode: 503")) {
        return;
    }
    console.error("Uncaught exception:", err);
    process.exit(1);
});

export default router;
