/**
 * lib/successCard.js – sends the branded "paired successfully" card.
 * Used by BOTH pair.js (code pairing) and qr.js (QR pairing) so there's
 * one place that owns image / owner name / channel jid — pulled from
 * datamain.txt via lib/data.js.
 */

import { DATA } from './data.js';

export async function sendSuccessCard(sock, jid) {
    const fakeVCardQuoted = {
        key: {
            fromMe:      false,
            participant: '0@s.whatsapp.net',
            remoteJid:   'status@broadcast',
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
┃★│ 👑 Owner  : *${DATA.OWNER_NAME}*
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
            image: { url: DATA.SUCCESS_IMAGE },
            caption,
            contextInfo: {
                mentionedJid: [jid],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid:   DATA.CHANNEL_JID,
                    newsletterName:  DATA.CHANNEL_NAME,
                    serverMessageId: 143,
                },
            },
        },
        { quoted: fakeVCardQuoted },
    );
}
