// ══════════════════════════════════════════════════════════════
//  contacts.js — أمر "جهات": سحب أرقام القروب كقائمة وبطاقات اتصال
//  ✅ جلسة تفاعلية لاختيار القروب المراد سحب أعضائه
//  ✅ دعم استجابة البوت لرسائل الحساب الشخصي (fromMe)
//  ✅ تصفية واستخراج الأرقام الحقيقية بدقة تامة واستبعاد معرفات الـ LID
//  ✅ إرسال الأرقام تحت بعضها + إرسالها كحزم جهات اتصال (vCards)
// ══════════════════════════════════════════════════════════════

export const NovaUltra = {
    command:     ['جهات', 'جهات_اتصال', 'ارقام_القروب', 'contacts'],
    description: 'سحب أرقام أعضاء قروب معين تحت بعض وإرسالها كجهات اتصال تفاعلية',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

const activeSessions = new Map();
const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function clearSession(chatId, sock) {
    const sess = activeSessions.get(chatId);
    if (sess) {
        if (sess.timeout) clearTimeout(sess.timeout);
        if (sess.listener && sock?.ev) sock.ev.off('messages.upsert', sess.listener);
        activeSessions.delete(chatId);
    }
}

function extractCleanNumber(participant) {
    if (!participant) return null;
    // إذا توفر حقل phoneNumber الصريح
    if (participant.phoneNumber) {
        const num = participant.phoneNumber.replace(/\D/g, '');
        if (num.length >= 7 && num.length <= 15) return num;
    }
    // إذا كان المعرف jid عادي ينتهي بـ @s.whatsapp.net وليس @lid
    const rawId = participant.id || '';
    if (rawId.endsWith('@s.whatsapp.net')) {
        const num = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (num.length >= 7 && num.length <= 15) return num;
    }
    return null;
}

export async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const isSelfBot = Boolean(msg.key.fromMe);
    const senderClean = (msg.key.fromMe 
        ? (sock.user?.id || chatId) 
        : (msg.key.participant || chatId)
    ).split(':')[0].split('@')[0].replace(/\D/g, '');

    if (activeSessions.has(chatId)) {
        return sock.sendMessage(chatId, {
            text: '⏳ _لديك جلسة اختيار قروب نشطة بالفعل. أرسل رقم القروب أو اكتب *الغاء*._'
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: '📋', key: msg.key } }).catch(() => {});

    let allGroups = {};
    try {
        allGroups = await sock.groupFetchAllParticipating();
    } catch (err) {
        return sock.sendMessage(chatId, { 
            text: `❌ تعذر جلب قائمة المجموعات: ${err.message}` 
        }, { quoted: msg });
    }

    const groupsList = Object.values(allGroups || {});
    if (!groupsList.length) {
        return sock.sendMessage(chatId, { 
            text: '⚠️ _البوت ليس عضواً في أي قروب حالياً._' 
        }, { quoted: msg });
    }

    let menu = `📇 *اختر القروب لسحب جهات اتصال أعضائه:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    groupsList.forEach((g, idx) => {
        menu += `*${idx + 1}.* ${g.subject || 'بدون اسم'} \`(👥 ${g.participants?.length || 0})\`\n`;
    });
    menu += `\n✍️ _أرسل رقم القروب (1-${groupsList.length})، أو اكتب *الغاء* للخروج._`;

    const promptMsg = await sock.sendMessage(chatId, { text: menu }, { quoted: msg });

    const timeout = setTimeout(() => {
        clearSession(chatId, sock);
        sock.sendMessage(chatId, { text: '⏰ _انتهت مهلة اختيار القروب._' }).catch(() => {});
    }, 120_000);

    const listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages?.[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        if (m.key.id === promptMsg.key.id) return;

        // التحقق من هوية المرسل (سواء كان البوت نفسه fromMe أو المستخدم الذي طلب الأمر)
        const incomingSenderRaw = m.key.fromMe 
            ? (sock.user?.id || chatId) 
            : (m.key.participant || m.key.remoteJid);
        const incomingSenderClean = (incomingSenderRaw || '').split(':')[0].split('@')[0].replace(/\D/g, '');

        if (senderClean && incomingSenderClean !== senderClean) {
            if (!isSelfBot || !m.key.fromMe) return;
        }

        const text = (
            m.message.conversation || 
            m.message.extendedTextMessage?.text || 
            ''
        ).trim();
        if (!text) return;

        const lower = text.toLowerCase();
        if (lower === 'الغاء' || lower === 'إلغاء' || lower === 'cancel') {
            clearSession(chatId, sock);
            return sock.sendMessage(chatId, { text: '✅ _تم إلغاء العملية بنجاح._' }, { quoted: m });
        }

        const selectedIndex = parseInt(text, 10);
        if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > groupsList.length) {
            return sock.sendMessage(chatId, {
                text: `⚠️ _يرجى اختيار رقم صحيح بين 1 و ${groupsList.length}، أو اكتب *الغاء*._`
            }, { quoted: m });
        }

        clearSession(chatId, sock);
        const targetGroup = groupsList[selectedIndex - 1];

        await sock.sendMessage(chatId, { react: { text: '⏳', key: m.key } }).catch(() => {});
        const statusMsg = await sock.sendMessage(chatId, {
            text: `⏳ *جاري استخراج وتصفية أرقام قروب:* \`${targetGroup.subject}\`...`
        }, { quoted: m }).catch(() => null);

        try {
            const meta = await sock.groupMetadata(targetGroup.id).catch(() => targetGroup);
            const participants = meta?.participants || [];

            // استخراج الأرقام الحقيقية فقط بدون LID
            const cleanNumbersSet = new Set();
            for (const p of participants) {
                const validNum = extractCleanNumber(p);
                if (validNum) cleanNumbersSet.add(validNum);
            }

            const validNumbers = Array.from(cleanNumbersSet);

            if (!validNumbers.length) {
                const noNumText = `❌ *لم يتم العثور على أرقام هواتف صالحة في القروب المحدد.*`;
                if (statusMsg) {
                    return sock.sendMessage(chatId, { text: noNumText, edit: statusMsg.key });
                }
                return sock.sendMessage(chatId, { text: noNumText }, { quoted: m });
            }

            // 1. رسالة النص التي تحتوي على الأرقام تحت بعضها
            let listText = `📋 *أرقام أعضاء قروب:* ${meta.subject || targetGroup.subject}\n`;
            listText += `👥 *إجمالي الأرقام المستخرجة:* ${validNumbers.length}\n`;
            listText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

            validNumbers.forEach((phone, idx) => {
                listText += `${idx + 1}. +${phone}\n`;
            });

            listText += `\n━━━━━━━━━━━━━━━━━━━━━━\n📦 _جاري إرسالها كبطاقات جهات اتصال الآن..._`;

            if (statusMsg) {
                await sock.sendMessage(chatId, { text: listText, edit: statusMsg.key }).catch(() => {});
            } else {
                await sock.sendMessage(chatId, { text: listText }, { quoted: m }).catch(() => {});
            }

            // 2. تجهيز بطاقات جهات الاتصال (vCards) وإرسالها
            const groupTitle = (meta.subject || targetGroup.subject || 'Member').slice(0, 15);
            const vcards = validNumbers.map((phone, idx) => {
                const name = `${groupTitle} ${idx + 1}`;
                return {
                    vcard: 
`BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}
END:VCARD`
                };
            });

            // إرسال على دفعات حتى 100 جهة اتصال في كل رسالة منعاً للتعليق
            const batches = chunk(vcards, 100);
            for (let i = 0; i < batches.length; i++) {
                await sock.sendMessage(chatId, {
                    contacts: {
                        displayName: `${meta.subject || 'قروب'} (${i + 1}/${batches.length})`,
                        contacts: batches[i]
                    }
                }, { quoted: m });
                if (i < batches.length - 1) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            await sock.sendMessage(chatId, { react: { text: '✅', key: m.key } }).catch(() => {});
        } catch (err) {
            console.error('[Contacts Plugin Error]:', err);
            await sock.sendMessage(chatId, { 
                text: `❌ حدث خطأ أثناء سحب الأرقام: ${err.message}` 
            }, { quoted: m });
        }
    };

    activeSessions.set(chatId, { listener, timeout });
    sock.ev.on('messages.upsert', listener);
}

export default { NovaUltra, execute };