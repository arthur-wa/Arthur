// ══════════════════════════════════════════════════════════════
//  فضح.js — تحويل صور وفيديوهات العرض لمرة واحدة إلى ميديا دائمة
// ══════════════════════════════════════════════════════════════

import { downloadMediaMessage } from "@whiskeysockets/baileys";

export const NovaUltra = {
    command:     ['فضح', 'فصح', 'vv'],
    description: 'تحويل الصور والفيديوهات المرسلة كعرض لمرة واحدة إلى دائمة',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

export async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    // جلب الرسالة المقتبسة
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    let quotedMessage = contextInfo?.quotedMessage;

    if (!quotedMessage) {
        await sock.sendMessage(chatId, {
            text: '↩️ *الرجاء الرد على صورة أو فيديو (عرض لمرة واحدة) لتثبيتها.*'
        }, { quoted: msg });
        return;
    }

    // فك التغليف لرسائل العرض لمرة واحدة بجميع أنواعها
    if (quotedMessage.viewOnceMessage?.message) quotedMessage = quotedMessage.viewOnceMessage.message;
    if (quotedMessage.viewOnceMessageV2?.message) quotedMessage = quotedMessage.viewOnceMessageV2.message;
    if (quotedMessage.viewOnceMessageV2Extension?.message) quotedMessage = quotedMessage.viewOnceMessageV2Extension.message;

    // تحديد نوع الميديا
    const mtype = Object.keys(quotedMessage || {}).find(k => k === 'imageMessage' || k === 'videoMessage');

    if (!mtype) {
        await sock.sendMessage(chatId, {
            text: '❌ الرسالة المقتبسة ليست صورة أو فيديو عرض لمرة واحدة.'
        }, { quoted: msg });
        return;
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

    try {
        // بناء كائن رسالة وهمي لتمريره لدالة التحميل
        const mediaMsg = {
            key: {
                remoteJid: chatId,
                id: contextInfo.stanzaId,
                participant: contextInfo.participant
            },
            message: quotedMessage
        };

        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, {
            logger: sock.logger,
            reuploadRequest: sock.updateMediaMessage
        });

        const caption = `🔓 *تم فك القفل بنجاح وعرضها بشكل دائم*`;
        const messageContent = mtype === 'imageMessage' ? { image: buffer, caption } : { video: buffer, caption, mimetype: 'video/mp4' };

        await sock.sendMessage(chatId, messageContent, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});
    } catch (err) {
        console.error('[Reveal Error]:', err.message);
        await sock.sendMessage(chatId, { text: '❌ فشل تحميل أو فك قفل الميديا. قد تكون الرسالة قديمة جداً.' }, { quoted: msg });
    }
}

export default { NovaUltra, execute };
