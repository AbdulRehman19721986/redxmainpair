/*****************************************************************************
 *                                                                           *
 *               REDXBOT302 v7.1 ULTRA — SESSION BOT EDITION               *
 *                                                                           *
 *  🔥  Owner    : Abdul Rehman Rajpoot                                     *
 *  📱  Number   : +923009842133                                            *
 *  🌐  GitHub   : https://github.com/AbdulRehman19721986/redxbot302        *
 *  ▶️  YouTube  : https://youtube.com/@rootmindtech                        *
 *  💬  WhatsApp : https://whatsapp.com/channel/0029VbCPnYf96H4SNehkev10   *
 *  🔗  Telegram : https://t.me/TeamRedxhacker2                             *
 *                                                                           *
 *    500+ commands | 24/7 uptime | Anti-ban | DM + Groups                 *
 *    Session-based: uses SESSION_ID env var (no pairing panel needed)      *
 *                                                                           *
 *    © 2026 Abdul Rehman Rajpoot. All rights reserved.                     *
 *                                                                           *
 *****************************************************************************/

/* ============================================================
   ESM COMPATIBILITY SHIMS
   package.json has "type":"module" but this file uses CJS-style
   require(). createRequire bridges the gap without rewriting the
   whole file. __filename / __dirname are not auto-defined in ESM.
   ============================================================ */
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';
const require    = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname  = require('path').dirname(__filename);

/* ============================================================
   GLOBAL ERROR SUPPRESSION — MUST BE FIRST
   ============================================================ */
const _origError = console.error.bind(console);
const _errCounts = new Map();
console.error = function (...args) {
    const msg = args.join(' ');
    const noisy = ['Bad MAC', 'Failed to decrypt', 'Decryption failed',
                   'retry message', 'No SenderKeyRecord', 'calling postMessage'];
    const matched = noisy.find(n => msg.includes(n));
    if (matched) {
        const c = (_errCounts.get(matched) || 0) + 1;
        _errCounts.set(matched, c);
        if (c <= 3) _origError(...args);
        else if (c === 4) _origError('[Suppressed] Further decryption errors hidden.');
        return;
    }
    _origError(...args);
};

/* ============================================================
   FFMPEG AUTO-SETUP
   ============================================================ */
const path = require('path');
const fs   = require('fs');

(function setupFFmpeg() {
    try {
        const ffmpegStatic = require('ffmpeg-static');
        if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
            process.env.FFMPEG_PATH = ffmpegStatic;
            require('fluent-ffmpeg').setFfmpegPath(ffmpegStatic);
            console.log('✅ ffmpeg-static loaded');
            return;
        }
    } catch (_) {}

    try {
        const inst = require('@ffmpeg-installer/ffmpeg');
        if (inst && inst.path && fs.existsSync(inst.path)) {
            process.env.FFMPEG_PATH = inst.path;
            require('fluent-ffmpeg').setFfmpegPath(inst.path);
            console.log('✅ @ffmpeg-installer loaded');
            return;
        }
    } catch (_) {}

    const { execSync } = require('child_process');
    try {
        const sysPath = execSync('which ffmpeg').toString().trim();
        if (sysPath) {
            process.env.FFMPEG_PATH = sysPath;
            require('fluent-ffmpeg').setFfmpegPath(sysPath);
            console.log('✅ System ffmpeg:', sysPath);
            return;
        }
    } catch (_) {}

    console.warn('⚠️ ffmpeg not found — media commands may fail.');
})();

/* ============================================================
   CORE DEPENDENCIES
   ============================================================ */
require('dotenv').config();
require('./config');
require('./settings.cjs');

const { Boom }        = require('@hapi/boom');
const chalk           = require('chalk');
const syntaxerror     = require('syntax-error');
const axios           = require('axios');
const PhoneNumber     = require('awesome-phonenumber');
const readline        = require('readline');
const NodeCache       = require('node-cache');
const pino            = require('pino');
const { rmSync, existsSync, mkdirSync } = require('fs');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay,
} = require('@whiskeysockets/baileys');

const store          = require('./lib/lightweight_store');
const { passesMode } = require('./lib/modeCheck');
const { getCachedGroupMetadata, invalidateMetaCache } = require('./lib/isAdmin');
const { handleMessageEdit, handleMessageRevocation } = require('./plugins/antidelete');
const {
    warmLidCache,
    onContactsUpdate,
    onContactsUpsert,
    onGroupsUpdate,
    onPresenceUpdate,
    samePhone,
    cleanJid,
    cacheLidMapping,
} = require('./lib/senderResolver');
const { runSessionGuard } = require('./lib/sessionGuard');
const SaveCreds      = require('./lib/session');
const { server, PORT } = require('./lib/server');
const { printLog }   = require('./lib/print');
const {
    handleMessages,
    handleStatus,
    handleCall,
    handleGroupParticipantUpdate,
} = require('./lib/messageHandler');
const settings       = require('./settings.cjs');
const commandHandler = require('./lib/commandHandler');
const { initPresenceManager, onOwnerActivity } = require('./lib/presenceManager');

/* ── Auto view-once interceptor ─────────────────────────────────── */
let _autoVV = null;
try {
    const vvPlugin = require('./plugins/advanced-vv');
    if (typeof vvPlugin.handleAutoVV === 'function') {
        _autoVV = vvPlugin.handleAutoVV;
    } else if (Array.isArray(vvPlugin)) {
        for (const item of vvPlugin) {
            if (typeof item?.handleAutoVV === 'function') { _autoVV = item.handleAutoVV; break; }
        }
    }
    if (_autoVV) console.log('[VV] ✅ Auto view-once interceptor loaded');
} catch (e) {
    console.error('[VV] Failed to load advanced-vv:', e.message);
}

/* ============================================================
   TEMP DIRECTORIES
   ============================================================ */
const TEMP_DIR = path.join(process.cwd(), 'temp');
const TMP_DIR  = path.join(process.cwd(), 'tmp');
for (const d of [TEMP_DIR, TMP_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
process.env.TMPDIR = TEMP_DIR;
process.env.TEMP   = TEMP_DIR;
process.env.TMP    = TEMP_DIR;

/* ============================================================
   INITIAL SETUP
   ============================================================ */
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);
commandHandler.loadCommands();

/* ============================================================
   MEMORY & TEMP MANAGEMENT
   ============================================================ */
function cleanTempDirs() {
    for (const dir of [TEMP_DIR, TMP_DIR]) {
        try {
            if (!fs.existsSync(dir)) continue;
            let count = 0;
            for (const f of fs.readdirSync(dir)) {
                const fp = path.join(dir, f);
                try {
                    if (Date.now() - fs.statSync(fp).mtimeMs > 30 * 60 * 1000) {
                        fs.unlinkSync(fp);
                        count++;
                    }
                } catch {}
            }
            if (count > 0) console.log(`🧹 Cleaned ${count} temp files`);
        } catch {}
    }
}
setInterval(cleanTempDirs, 20 * 60 * 1000);
setInterval(() => {
    if (global.gc) global.gc();
    const usedMB = process.memoryUsage().rss / 1024 / 1024;
    if (usedMB > 450) { console.warn(chalk.yellow(`⚠️ RAM: ${usedMB.toFixed(0)}MB`)); cleanTempDirs(); }
}, 3 * 60 * 1000);

/* ============================================================
   KEEP-ALIVE (24/7 uptime)
   ============================================================ */
const APP_URL = process.env.APP_URL ||
    (process.env.HEROKU_APP_NAME ? `https://${process.env.HEROKU_APP_NAME}.herokuapp.com` : null);
if (APP_URL && !APP_URL.includes('undefined')) {
    setInterval(() => axios.get(APP_URL + '/ping').catch(() => {}), 14 * 60 * 1000);
    console.log(chalk.cyan(`🔄 Keep-alive active → ${APP_URL}/ping`));
}

/* ============================================================
   PAIRING SETUP
   ============================================================ */
let phoneNumber = global.PAIRING_NUMBER || process.env.PAIRING_NUMBER || '';
let owner = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8'));

global.botname    = settings.botName    || 'REDXBOT302';
global.themeemoji = '•';

let rl = null;
if (process.stdin.isTTY && !process.env.PAIRING_NUMBER) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}
const question = (text) =>
    (rl && !rl.closed)
        ? new Promise(resolve => rl.question(text, resolve))
        : Promise.resolve(settings.ownerNumber || phoneNumber);

process.on('exit',    () => { if (rl && !rl.closed) rl.close(); });
process.on('SIGINT',  () => { if (rl && !rl.closed) rl.close(); process.exit(0); });
// Render sends SIGTERM on deploy/shutdown — catch it and restart instead of dying
process.on('SIGTERM', () => {
    printLog('warning', 'SIGTERM received — graceful restart in 3s...');
    if (rl && !rl.closed) rl.close();
    setTimeout(() => startBot().catch(() => process.exit(0)), 3000);
});

/* ============================================================
   SESSION MANAGEMENT
   ============================================================ */
function ensureSessionDirectory() {
    const p = path.join(__dirname, 'session');
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
    return p;
}

function hasValidSession() {
    try {
        const cp = path.join(__dirname, 'session', 'creds.json');
        if (!existsSync(cp)) return false;
        const raw = fs.readFileSync(cp, 'utf8');
        if (!raw.trim()) return false;
        const creds = JSON.parse(raw);
        if (!creds.noiseKey || !creds.signedIdentityKey || !creds.signedPreKey) return false;
        if (creds.registered === false) {
            rmSync(path.join(__dirname, 'session'), { recursive: true, force: true });
            return false;
        }
        printLog('success', 'Valid session found ✅');
        return true;
    } catch { return false; }
}

async function initializeSession() {
    const AUTH_DIR = path.join(__dirname, 'session');
    const CREDS    = path.join(AUTH_DIR, 'creds.json');

    // ── Fast path: creds already on disk ─────────────────────────
    if (existsSync(CREDS)) return hasValidSession();

    const txt = (global.SESSION_ID || process.env.SESSION_ID || '').trim();

    if (!txt) {
        printLog('warning', 'No SESSION_ID — pairing required.');
        return false;
    }

    // ── Universal session loader (handles ALL formats) ────────────
    // Formats: REDXBOT302~base64 | REDXBOT302~MEGA_id#key
    //          KIRA-MD~base64   | ANY_PREFIX~base64
    //          mega.nz URL      | id#key (bare MEGA)
    //          pastebin URL     | raw base64 | raw JSON
    try {
        await SaveCreds(txt, AUTH_DIR);
        await delay(1000);
        if (hasValidSession()) {
            printLog('success', '♻️ Session restored successfully ✅');
            return true;
        }
        printLog('error', 'Session decoded but failed validation — re-pair required.');
        return false;
    } catch (e) {
        printLog('error', `❌ Session load failed: ${e.message} — retrying in 10s`);
        await delay(10000);
        return false; // caller will handle re-pair
    }
}

/* ============================================================
   START SERVER
   ============================================================ */
server.listen(PORT, () => printLog('success', `🌐 Web server on port ${PORT}`));

const OWNER_SONG_URL = process.env.WELCOME_AUDIO || settings.ownerSongUrl ||
    'https://files.catbox.moe/voio3f.m4a';

/* ============================================================
   ✅ ANTI-BAN SOCKET CONFIG
   Copied from redxminibot (session bot) — Ubuntu Chrome fingerprint,
   slower retry delay, no online-on-connect, maxRetries cap.
   ============================================================ */
function buildSocketConfig(state, msgRetryCounterCache, getSock) {
    return {
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                pino({ level: 'silent' }).child({ level: 'silent' })
            ),
        },
        version: undefined,           // set by caller after fetchLatestBaileysVersion
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        // ✅ ANTI-BAN: Ubuntu Chrome is most common, least suspicious fingerprint
        browser: Browsers.ubuntu('Chrome'),
        // ✅ SPEED: Optimized for DMs + groups + channels
        keepAliveIntervalMs:      20_000,   // 20s — faster reconnect detection
        connectTimeoutMs:         60_000,   // 60s — give time on slow networks
        defaultQueryTimeoutMs:    15_000,   // 15s per query
        // ✅ ANTI-BAN: Slower retry — aggressive reconnect triggers ban
        retryRequestDelayMs:      2_000,
        maxRetries:               5,        // more retries for resilience
        // ✅ ANTI-BAN: Don't appear online on connect — presence manager handles it
        markOnlineOnConnect:      false,
        generateHighQualityLinkPreview: false,
        syncFullHistory:          false,
        emitOwnEvents:            true,
        fireInitQueries:          true,
        msgRetryCounterCache,
        // 🩹 FIX: without this, Baileys calls groupMetadata() fresh on EVERY
        // message/reaction/delete sent to a group (see messages-send.js).
        // Under burst traffic this hammers WA and triggers rate-overlimit
        // (429) storms that break antilink delete, reactions, and admin
        // commands (mute/unmute/kick) all at once. 5-min cache, shared with
        // isAdmin.js, invalidated instantly on group-participants.update.
        cachedGroupMetadata: async (jid) => {
            const s = getSock && getSock();
            if (!s) return undefined;
            try { return await getCachedGroupMetadata(s, jid); } catch { return undefined; }
        },
        getMessage: async (key) => {
            const msg = await store.loadMessage(jidNormalizedUser(key.remoteJid), key.id);
            return msg?.message || undefined;
        },
    };
}

/* ============================================================
   MAIN BOT FUNCTION
   ============================================================ */
// Track reconnect attempts across restarts
let _reconnectAttempts = 0;

async function startBot() {
    try {
        // Fetch latest Baileys version (with fallback)
        let version;
        try {
            const result = await fetchLatestBaileysVersion();
            version = result.version;
        } catch (_verErr) {
            printLog('warning', 'fetchLatestBaileysVersion failed — using fallback [2,3000,1023455050]');
            version = [2, 3000, 1023455050];
        }

        ensureSessionDirectory();
        await delay(1000);

        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const msgRetryCounterCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

        // ── Build socket using anti-ban config ──────────────────────────
        let sock; // declared early so cachedGroupMetadata closure can see it once assigned
        const sockConfig = buildSocketConfig(state, msgRetryCounterCache, () => sock);
        sockConfig.version = version;

        sock = makeWASocket(sockConfig);

        // ── Expose session number globally (for isOwner sessionId check) ─
        // Set once creds are available; updated on connection.open
        if (state.creds?.me?.id) {
            global.sessionNumber = state.creds.me.id.split(':')[0].split('@')[0];
        } else {
            // fallback: use ownerNumber as session number (single-session bot)
            global.sessionNumber = (settings.ownerNumber || '').replace(/\D/g, '');
        }

        /* ------ Store bind ------ */
        store.bind(sock.ev);

        /* ------ RC13 LID cache population ────── */
        sock.ev.on('contacts.update', onContactsUpdate);
        sock.ev.on('contacts.upsert', (contacts) => {
            onContactsUpsert(contacts);
            if (!Array.isArray(contacts)) return;
            for (const c of contacts) {
                if (c?.id && c?.lid) cacheLidMapping(cleanJid(c.lid), c.id);
            }
        });
        sock.ev.on('groups.update',   (groups)  => onGroupsUpdate(groups));
        sock.ev.on('presence.update', onPresenceUpdate);

        // 🩹 FIX: Baileys re-emits MESSAGE_EDIT protocol messages via
        // 'messages.update' (see process-message.js), NOT 'messages.upsert'.
        // antidelete's edit-tracking was wired to nothing — this listener
        // was simply missing, so .antidelete edits on/off had zero effect.
        // Also handles Baileys v6 revocation events (update.message === null).
        sock.ev.on('messages.update', async (updates) => {
            for (const u of (updates || [])) {
                // Edit event
                if (u?.update?.message?.editedMessage) {
                    handleMessageEdit(sock, u).catch(e => printLog('error', `Antidelete edit: ${e.message}`));
                    continue;
                }
                // Revocation via messages.update (Baileys v6 style)
                if (u?.update?.message === null && u?.key?.id) {
                    const syntheticMsg = {
                        key: u.key,
                        message: {
                            protocolMessage: {
                                key: u.key,
                                type: 0
                            }
                        },
                        participant: u.key?.participant || u.key?.remoteJid
                    };
                    handleMessageRevocation(sock, syntheticMsg)
                        .catch(e => printLog('error', `Antidelete revoke (update): ${e.message}`));
                }
            }
        });

        // Extra: learn LID from every message (belt & suspenders)
        sock.ev.on('messages.upsert', async ({ messages: _msgs }) => {
            for (const m of (_msgs || [])) {
                if (m?.key?.remoteJid?.includes('@lid') && m?.key?.participant == null) {
                    if (m?.pushName && sock?.store?.contacts) {
                        const lid = m.key.remoteJid;
                        const existing = sock.store.contacts[lid] || {};
                        sock.store.contacts[lid] = {
                            ...existing, id: lid,
                            notify: m.pushName, name: m.pushName, lid,
                        };
                    }
                }
            }
        }, { prepend: true });

        /* ------ Creds save ------ */
        sock.ev.on('creds.update', saveCreds);

        /* ------ Messages (DM + Groups — both handled) ------ */
        sock.ev.on('messages.upsert', async (update) => {
            try {
                const msgs = update.messages || [];
                const ownerNum = (settings.ownerNumber || '').replace(/\D/g, '');

                for (const msg of msgs) {
                    if (!msg?.message) continue;
                    const senderJid = msg.key?.participant || msg.key?.remoteJid || '';

                    // ── Owner presence pulse ──────────────────────────────
                    if (ownerNum && samePhone(cleanJid(senderJid), ownerNum)) {
                        onOwnerActivity(sock);
                    }
                    // Also trigger on fromMe (owner's own device)
                    if (msg.key?.fromMe) {
                        onOwnerActivity(sock);
                    }

                    // ── Auto view-once interceptor ────────────────────────
                    if (_autoVV) {
                        _autoVV(sock, msg).catch(() => {});
                    }
                }

                // ── Route to full feature pipeline (lib/messageHandler) ──
                await handleMessages(sock, update);
            } catch (e) {
                printLog('error', `handleMessages: ${e.message}`);
            }
        });

        /* ------ Status ------ */
        sock.ev.on('status.update', async (status) => {
            try { await handleStatus(sock, status); } catch {}
        });

        /* ------ Calls ------ */
        sock.ev.on('call', async (calls) => {
            try { await handleCall(sock, calls); } catch {}
        });

        /* ------ Group events ------ */
        sock.ev.on('group-participants.update', async (update) => {
            invalidateMetaCache(update?.id); // demote/promote/add/remove → cache stale, drop it
            try { await handleGroupParticipantUpdate(sock, update); } catch {}
        });

        /* ------ Connection update ------ */
        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (connection === 'open') {
                printLog('success', '✅ WhatsApp connected!');
                _reconnectAttempts = 0;

                // Update session number from live creds
                if (sock.user?.id) {
                    global.sessionNumber = sock.user.id.split(':')[0].split('@')[0];
                    printLog('info', `📱 Session: +${global.sessionNumber}`);
                }

                // ── LID cache warm-up ──────────────────────────────────
                setTimeout(() => warmLidCache(sock).catch(() => {}), 3000);

                // ── STEALTH PRESENCE: go offline after connect ─────────
                initPresenceManager(sock);

                const now = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
                const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';

                // Reload all plugins fresh on connect
                commandHandler.reloadCommands && commandHandler.reloadCommands();

                const caption =
                    `╔══════════════════════════════╗\n` +
                    `║   🔥 REDXBOT302 v7.1 ULTRA   ║\n` +
                    `║  By Abdul Rehman Rajpoot 👑  ║\n` +
                    `╚══════════════════════════════╝\n\n` +
                    `✅ *Bot is ONLINE & ULTRA FAST!*\n` +
                    `🕐 *Time:* ${now}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📌 *Prefix:* ${settings.prefixes[0]}\n` +
                    `👑 *Owner:* ${settings.ownerName}\n` +
                    `🔢 *Version:* v${settings.version}\n` +
                    `🌍 *Platform:* ${settings.platform.toUpperCase()}\n` +
                    `🔌 *Commands:* ${commandHandler.commands?.size || '500+'}\n` +
                    `📱 *Session:* +${global.sessionNumber}\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🔗 *Channel:* ${settings.channelLink}\n` +
                    `📢 *Group:* ${settings.whatsappGroup}\n` +
                    `⭐ *GitHub:* ${settings.githubRepo}\n\n` +
                    `✨ _REDXBOT302 v7.1 ULTRA — Always Here For You!_ ✨`;

                try {
                    const res = await axios.get(settings.botDp, { responseType: 'arraybuffer', timeout: 10000 });
                    const dpBuf = Buffer.from(res.data);
                    // Send welcome image to owner DM
                    await sock.sendMessage(botJid, { image: dpBuf, caption });
                    // Also update bot's actual WhatsApp profile picture
                    try {
                        await sock.updateProfilePicture(sock.user.id, dpBuf);
                        printLog('info', '🖼️  Profile picture updated');
                    } catch (e) {
                        printLog('warning', `Profile pic update skipped: ${e.message}`);
                    }
                    // Update bot name
                    try {
                        await sock.updateProfileName(settings.botName || 'REDXBOT302');
                        printLog('info', `✏️  Profile name set: ${settings.botName}`);
                    } catch {}
                } catch {
                    await sock.sendMessage(botJid, { text: caption }).catch(() => {});
                }

                try {
                    await sock.sendMessage(botJid, {
                        audio: { url: OWNER_SONG_URL },
                        mimetype: 'audio/mpeg',
                        ptt: false,
                    });
                } catch {}

                const _startMode = global.MODE || 'public';
                console.log(chalk.cyan('\n╔══════════════════════════════════╗'));
                console.log(chalk.magenta(`║  🔥 REDXBOT302 v${settings.version} ULTRA`));
                console.log(chalk.green( `║  👑 Owner: ${settings.ownerName}`));
                console.log(chalk.yellow(`║  📦 Commands: ${commandHandler.commands?.size || '500+'}`));
                console.log(chalk.blue(  `║  🌍 Platform: ${settings.platform.toUpperCase()}`));
                console.log(chalk.cyan(  `║  🔒 Mode: ${_startMode.toUpperCase()}`));
                console.log(chalk.cyan(  `║  📱 Session: +${global.sessionNumber}`));
                console.log(chalk.cyan(  '╚══════════════════════════════════╝\n'));
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                printLog('error', `Connection closed — Code: ${code}`);

                if (code === DisconnectReason.loggedOut || code === 401) {
                    try { rmSync('./session', { recursive: true, force: true }); } catch {}
                    printLog('warning', 'Logged out — re-authenticate via SESSION_ID.');
                    return;
                }

                const isLoggedOut = code === 405;
                if (isLoggedOut) {
                    printLog('warning', 'Session banned or replaced — deleting session.');
                    try { rmSync('./session', { recursive: true, force: true }); } catch {}
                    return;
                }

                // ✅ ANTI-BAN: Exponential backoff with jitter — aggressive reconnect = ban
                _reconnectAttempts++;
                if (_reconnectAttempts <= 5) {
                    const base   = 5000 * _reconnectAttempts;
                    const jitter = Math.floor(Math.random() * 3000);
                    const wait   = Math.min(base + jitter, 60_000);
                    if (code === 429) {
                        printLog('warning', 'Rate limited — waiting 30s...');
                        await delay(30000);
                    } else {
                        printLog('connection', `Reconnecting in ${(wait / 1000).toFixed(1)}s (${_reconnectAttempts}/5)...`);
                        await delay(wait);
                    }
                    startBot().catch(err => printLog('error', `Reconnect error: ${err.message}`));
                } else {
                    printLog('error', `Max reconnects (5) reached. Waiting 2min before final retry...`);
                    _reconnectAttempts = 0;
                    await delay(120_000);
                    startBot().catch(() => {});
                }
            }
        });

        /* ------ Pairing code (no SESSION_ID case) ------ */
        if (!state.creds?.registered) {
            printLog('warning', 'Session not registered. Pairing needed.');
            let num = phoneNumber || process.env.PAIRING_NUMBER;
            if (!num && rl && !rl.closed) {
                num = await question(chalk.bgBlack(chalk.greenBright('Enter WhatsApp number (no +): ')));
            }
            num = (num || '').replace(/[^0-9]/g, '');
            if (!num || !PhoneNumber('+' + num).isValid()) {
                printLog('error', 'Invalid phone number — retrying in 30s.');
                await delay(30000);
                return startBot();
            }
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(chalk.bgGreen('Pairing Code:'), chalk.white(code));
                    if (rl) { rl.close(); rl = null; }
                } catch (e) {
                    printLog('error', `Pairing code error: ${e.message}`);
                }
            }, 3000);
        } else {
            if (rl) { rl.close(); rl = null; }
        }

        return sock;

    } catch (err) {
        printLog('error', `startBot error: ${err.message}`);
        await delay(8000);
        return startBot();
    }
}

/* ============================================================
   MAIN ENTRY
   ============================================================ */
async function main() {
    printLog('info', '🚀 Starting REDXBOT302 v7.1 ULTRA (Session Bot Edition)...');

    // ── Ensure botMode is always set on startup ─────────────────────
    try {
        await store.readFromFile();
        const currentMode = await store.getBotMode();
        const VALID_MODES = ['public', 'groups', 'inbox', 'private', 'self'];
        if (!currentMode || currentMode === 'undefined' || !VALID_MODES.includes(currentMode)) {
            await store.setBotMode('public');
            global.MODE = 'public';
            printLog('info', `🌍 botMode initialised → public (was: ${currentMode || 'unset'})`);
        } else {
            global.MODE = currentMode;
            printLog('info', `🔧 botMode restored → ${currentMode.toUpperCase()}`);
        }
    } catch (e) {
        printLog('warning', `botMode init skipped: ${e.message}`);
        global.MODE = process.env.MODE || 'public';
    }

    // ── Set session number early (before connection) ─────────────────
    global.sessionNumber = (settings.ownerNumber || process.env.OWNER_NUMBER || '').replace(/\D/g, '');

    const ready = await initializeSession();
    if (!ready) printLog('warning', 'No session. Will trigger pairing...');
    await delay(3000);

    runSessionGuard('./session');

    const _startWithRetry = async (attempt = 1) => {
        try { await startBot(); }
        catch (err) {
            const wait = Math.min(10000 * attempt, 60000);
            printLog('error', `Fatal startup (attempt ${attempt}): ${err.message} — retry in ${wait/1000}s`);
            setTimeout(() => _startWithRetry(attempt + 1), wait);
        }
    };
    _startWithRetry();
}

main();

/* ============================================================
   GLOBAL ERROR HANDLERS + AUTO-RESTART
   ============================================================ */
let _crashCount   = 0;
const MAX_CRASHES = 25; // bumped — Render needs more tolerance

process.on('uncaughtException', async (err) => {
    printLog('error', `UncaughtException: ${err.message}`);
    if (err.stack) console.error(err.stack);

    if (err.message?.includes('EADDRINUSE')) {
        printLog('error', 'Port in use — waiting 5s then retrying...');
        setTimeout(() => startBot().catch(() => {}), 5000);
        return;
    }

    _crashCount++;
    const wait = Math.min(5000 * _crashCount, 30000);

    if (_crashCount <= MAX_CRASHES) {
        printLog('warning', `Auto-restart in ${wait / 1000}s (${_crashCount}/${MAX_CRASHES})...`);
        setTimeout(() => {
            _crashCount = Math.max(0, _crashCount - 1);
            startBot().catch(() => {});
        }, wait);
    } else {
        printLog('error', 'Too many crashes. Waiting 2min before final retry...');
        setTimeout(() => { _crashCount = 0; startBot().catch(() => {}); }, 120000);
    }
});

process.on('unhandledRejection', (err) => {
    const msg = err?.message || String(err);
    if (['rate-overlimit', '429', 'Stream Errored', 'Connection Closed',
         'Connection Terminated', 'timed out'].some(s => msg.includes(s))) {
        printLog('warning', `Handled rejection (auto-recover): ${msg.slice(0, 80)}`);
        return;
    }
    printLog('error', `UnhandledRejection: ${msg.slice(0, 200)}`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        printLog('error', `Port ${PORT} is in use`);
        server.close();
    } else {
        printLog('error', `Server error: ${error.message}`);
    }
});

/* ============================================================
   SYNTAX CHECK ON ALL PLUGINS / LIB FILES
   ============================================================ */
const _checkFolders = [
    path.join(__dirname, './lib'),
    path.join(__dirname, './plugins'),
];
for (const folder of _checkFolders) {
    if (!existsSync(folder)) continue;
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.js') && f !== '1')) {
        // Skip large bundle files — they are auto-generated; syntax errors surface at load time
        if (file.startsWith('cat-')) continue;
        const fp = path.join(folder, file);
        try {
            const code = fs.readFileSync(fp, 'utf-8');
            const err  = syntaxerror(code, file, { sourceType: 'script', allowAwaitOutsideFunction: true });
            if (err) console.error(chalk.red(`❌ Syntax in ${file}: ${err}`));
        } catch (e) {
            console.error(chalk.yellow(`⚠️ Can't read ${file}: ${e.message}`));
        }
    }
}

/* ============================================================
   HOT RELOAD — watch this file for changes
   ============================================================ */
const _self = require.resolve(__filename);
fs.watchFile(_self, () => {
    fs.unwatchFile(_self);
    printLog('info', '♻️  index.js changed — hot-reloading...');
    delete require.cache[_self];
    require(_self);
});
