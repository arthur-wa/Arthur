const NovaUltra = {
    command:     ['ليد', 'lid'],
    description: 'استخراج معرّف الـ LID للشخص عبر المنشن أو الرد',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;

    // استخراج معلومات الرسالة وسياق الرد أو المنشن
    const messageContent = msg.message;
    const msgType = Object.keys(messageContent || {})[0];
    const contextInfo = messageContent?.[msgType]?.contextInfo;

    const targetJid = contextInfo?.mentionedJid?.[0] || contextInfo?.participant;

    if (!targetJid) {
        return sock.sendMessage(chatId, {
            text: "⚠️ *يرجى عمل منشن للشخص أو الرد على رسالته لاستخراج الـ LID.*\n\n*الاستخدام:*\n• `.ليد @منشن`\n• بالرد على رسالته: `.ليد`"
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: '🔍', key: msg.key } }).catch(() => {});

    try {
        let lid = null;
        const cleanTarget = targetJid.split(':')[0];

        // إذا كان المعرف المستخرج هو LID بالفعل
        if (cleanTarget.endsWith('@lid')) {
            lid = cleanTarget;
        } else {
            const phoneNum = cleanTarget.split('@')[0];

            // فحص خوادم واتساب لجلب الـ LID
            const [info] = await sock.onWhatsApp(phoneNum).catch(() => []);
            if (info?.exists && info?.lid) {
                lid = info.lid;
            }

            // فحص إضافي عبر بيانات المجموعة إن وجدت
            if (!lid && chatId.endsWith('@g.us')) {
                const metadata = await sock.groupMetadata(chatId).catch(() => null);
                const participant = metadata?.participants?.find(p => 
                    p.id.split(':')[0] === cleanTarget || p.phoneNumber === phoneNum
                );
                if (participant?.id?.endsWith('@lid')) {
                    lid = participant.id;
                }
            }
        }

        if (!lid) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatId, {
                text: "❌ *تعذر العثور على LID لهذا المستخدم.*"
            }, { quoted: msg });
        }

        const targetPhone = cleanTarget.split('@')[0];
        const responseText = 
`🪪 *بيانات الـ LID:*

👤 *المستخدم:* @${targetPhone}
🆔 *الـ LID:* \`${lid}\``;

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: responseText, mentions: [cleanTarget] }, { quoted: msg });
    } catch (err) {
        await sock.sendMessage(chatId, { react: { text: '⚠️', key: msg.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: `❌ حدث خطأ: ${err?.message || err}` }, { quoted: msg });
    }
}

export default { NovaUltra, execute };