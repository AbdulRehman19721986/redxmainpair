/**
 * pair.js – Phone number pairing route
 * GET /code?number=923XXXXXXXXX
 * → returns { code: "XXXX-XXXX" }
 * → on connect: encodes creds as REDXBOT302~<base64> → sends to WhatsApp with alive card
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
import pn from 'awesome-phonenumber';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const router = express.Router();

/* ===== SESSION GENERATOR ===== */
async function generateShortSession(credsPath) {
    try {
        const credsData   = fs.readFileSync(credsPath, 'utf-8');
        const base64Creds = Buffer.from(credsData).toString('base64');
        return {
            sessionId:   'REDXBOT302~',
            encodedData: base64Creds,
        };
    } catch (err) {
        console.error('Error generating session:', err);
        return null;
    }
}

/* ===== HELPERS ===== */
function rm(p) {
    try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch (e) {
        console.log('Cleanup error:', e);
    }
}

/* ===== ROUTE ===== */
router.get('/', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num) return res.status(400).send({ code: 'Number required' });

    const phone = pn('+' + num);
    if (!phone.isValid()) return res.status(400).send({ code: 'Invalid number' });
    num = phone.getNumber('e164').replace('+', '');

    const dir = './session' + num;
    rm(dir);

    async function start() {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version }          = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },
            logger:             pino({ level: 'fatal' }),
            browser:            Browsers.windows('Chrome'),
            printQRInTerminal:  false,
            markOnlineOnConnect: false,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                try {
                    // Wait for creds to be fully saved
                    await delay(3000);

                    const credsPath  = join(dir, 'creds.json');
                    const sessionInfo = await generateShortSession(credsPath);

                    if (!sessionInfo) throw new Error('Failed to generate session');

                    const jid            = jidNormalizedUser(num + '@s.whatsapp.net');
                    const completeSession = `${sessionInfo.sessionId}${sessionInfo.encodedData}`;

                    // 1️⃣ Send session string
                    await sock.sendMessage(jid, { text: completeSession });

                    // 2️⃣ Brief pause
                    await delay(2000);

                    // 3️⃣ Send alive-style bot card (fake vCard quoted + image + caption)
                    const fakeVCardQuoted = {
                        key: {
                            fromMe:    false,
                            participant: '0@s.whatsapp.net',
                            remoteJid: 'status@broadcast',
                        },
                        message: {
                            contactMessage: {
                                displayName: '© REDXBOT302',
                                vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:© REDXBOT302\nORG:RedXAI Official;\nTEL;type=CELL;type=VOICE;waid=13135550002:+13135550002\nEND:VCARD`,
                            },
                        },
                    };

                    const caption = `
╭━〔 *ʀᴇᴅxʙᴏᴛ302* 〕━··๏
┃★╭──────────────
┃★│ 👑 Owner  : *Abdul Rehman Rajpoot*
┃★│ 🤖 Baileys: *Multi Device*
┃★│ 💻 Type   : *NodeJs*
┃★│ 🚀 Deploy : *Render / Koyeb*
┃★│ ⚙️ Mode   : *Public*
┃★│ 🔣 Prefix : *[ . ]*
┃★│ 🏷️ Version: *3.6.0*
┃★╰──────────────
╰━━━━━━━━━━━━━━┈⊷`;

                    await sock.sendMessage(
                        jid,
                        {
                            image: { url: 'https://files.catbox.moe/jftrh0.jpg' },
                            caption,
                            contextInfo: {
                                mentionedJid: [jid],
                                forwardingScore: 999,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid:     '120363426816577327@newsletter',
                                    newsletterName:    '❀༒★[ʀᴇᴅxʙᴏᴛ302]★༒❀',
                                    serverMessageId:   143,
                                },
                            },
                        },
                        { quoted: fakeVCardQuoted },
                    );

                    // 4️⃣ Cleanup & exit
                    await delay(2000);
                    rm(dir);
                    setTimeout(() => process.exit(0), 1000);

                } catch (err) {
                    console.error('❌ Error in pairing process:', err);
                    rm(dir);
                    try {
                        const jid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await sock.sendMessage(jid, { text: '❌ Error generating session. Please try again.' });
                    } catch (_) {}
                    process.exit(1);
                }
            }

            if (connection === 'close') {
                const c = lastDisconnect?.error?.output?.statusCode;
                if (c !== 401) setTimeout(() => start(), 2000);
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(3000);
            try {
                let code = await sock.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                if (!res.headersSent) {
                    res.send({ success: true, code, message: 'Enter code in WhatsApp > Linked Devices' });
                }
            } catch (err) {
                console.error('Pairing error:', err);
                if (!res.headersSent) res.status(503).send({ code: 'PAIR_FAIL', error: err.message });
                rm(dir);
                process.exit(1);
            }
        }
    }

    start();
});

/* ===== SAFETY ===== */
process.on('uncaughtException', (err) => {
    const e = String(err);
    if (e.includes('conflict') || e.includes('not-authorized') || e.includes('Timed Out')) return;
    console.error('Crash:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

export default router;
