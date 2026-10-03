// ══════════════════════════════════════════════════════════════
//  check_devices.js — أمر "فحص_اجهزة": جلسة تفاعلية لاختيار قروب
//  يقوم بسحب كل قروبات البوت، وتحديد قروب برقم لفحص كل أعضائه
// ══════════════════════════════════════════════════════════════

const NovaUltra = {
    command:     ['فحص', 'فحص_اجهزة', 'فحص_قروب', 'كشف_قروب', 'checkdev'],
    description: 'فحص جميع أعضاء قروب معين وكشف الأجهزة المرتبطة لكل عضو عبر جلسة تفاعلية',
    elite:       'on',
    group:       false,
    prv:         false,
    lock:        'off',
};

const activeSessions = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function clearSession(chatId, sock) {
    const sess = activeSessions.get(chatId);
    if (sess) {
        if (sess.timeout) clearTimeout(sess.timeout);
        if (sess.listener) sock.ev.off('messages.upsert', sess.listener);
        activeSessions.delete(chatId);
    }
}

async function getCompanions(sock, jids, onProgress) {
    const out = {};
    const cleanJids = [...new Set(
        jids.map(j => {
            const num = (j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            return num ? `${num}@s.whatsapp.net` : null;
        }).filter(Boolean)
    )];

    const parts = chunk(cleanJids, 35);
    let processed = 0;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        try {
            const devices = await sock.getUSyncDevices(part, false, false);
            for (const d of (devices || [])) {
                const devId = (typeof d?.device === 'number' && d.device > 0) ? d.device : (typeof d?.id === 'number' && d.id > 0 ? d.id : null);
                if (devId !== null) {
                    const key = `${d.user}`;
                    if (!out[key]) out[key] = new Set();
                    out[key].add(devId);
                }
            }
        } catch (e) {
            console.error('[Group USync Error]:', e.message);
        }
        processed += part.length;
        if (onProgress) await onProgress(processed, cleanJids.length);
        if (i < parts.length - 1) await sleep(1200);
    }

    const normalizedOut = {};
    for (const [user, set] of Object.entries(out)) {
        normalizedOut[user] = Array.from(set);
    }
    return { out: normalizedOut, totalClean: cleanJids.length };
}

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const senderRaw = msg.key.fromMe ? (sock.user?.id || chatId) : (msg.key.participant || chatId);
    const senderClean = (senderRaw || '').split(':')[0].split('@')[0].replace(/\D/g, '');

    if (activeSessions.has(chatId)) {
        return sock.sendMessage(chatId, {
            text: '⏳ _لديك جلسة فحص نشطة حالياً. اختر رقماً أو اكتب *الغاء*._'
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: '📋', key: msg.key } }).catch(() => {});

    let allGroups = {};
    try {
        allGroups = await sock.groupFetchAllParticipating();
    } catch (err) {
        return sock.sendMessage(chatId, { text: `❌ تعذر جلب قائمة المجموعات: ${err.message}` }, { quoted: msg });
    }

    const groupsList = Object.values(allGroups);
    if (!groupsList.length) {
        return sock.sendMessage(chatId, { text: '⚠️ _البوت ليس عضواً في أي قروب حالياً._' }, { quoted: msg });
    }

    let menu = `📦 *اختر القروب المراد فحص أجهزة أعضائه:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    groupsList.forEach((g, idx) => {
        menu += `*${idx + 1}.* ${g.subject || 'بدون اسم'} \`(👥 ${g.participants?.length || 0})\`\n`;
    });
    menu += `\n✍️ _أرسل رقم القروب (1-${groupsList.length}) للبدء، أو اكتب *الغاء*._`;

    const promptMsg = await sock.sendMessage(chatId, { text: menu }, { quoted: msg });

    const timeout = setTimeout(() => {
        clearSession(chatId, sock);
        sock.sendMessage(chatId, { text: '⏰ _انتهت مهلة اختيار القروب تلقائياً._' }).catch(() => {});
    }, 120_000);

    const listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;

        const incomingSenderRaw = m.key.fromMe ? (sock.user?.id || chatId) : (m.key.participant || m.key.remoteJid);
        const incomingSenderClean = (incomingSenderRaw || '').split(':')[0].split('@')[0].replace(/\D/g, '');
        if (senderClean && incomingSenderClean !== senderClean) return;

        const txt = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!txt) return;

        if (txt.toLowerCase() === 'الغاء' || txt.toLowerCase() === 'إلغاء' || txt.toLowerCase() === 'stop') {
            clearSession(chatId, sock);
            return sock.sendMessage(chatId, { text: '✅ _تم إلغاء جلسة الفحص._' }, { quoted: m });
        }

        const selectedIndex = parseInt(txt, 10);
        if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > groupsList.length) {
            return sock.sendMessage(chatId, {
                text: `⚠️ _يرجى اختيار رقم صحيح من القائمة (1 إلى ${groupsList.length}) أو اكتب *الغاء*._`
            }, { quoted: m });
        }

        clearSession(chatId, sock);
        const targetGroup = groupsList[selectedIndex - 1];

        const statusMsg = await sock.sendMessage(chatId, {
            text: `⏳ *جاري فحص أعضاء:* \`${targetGroup.subject}\`\n_الرجاء الانتظار قليلاً لتجنب حظر الخوادم..._`
        }, { quoted: m }).catch(() => null);

        try {
            const meta = await sock.groupMetadata(targetGroup.id).catch(() => targetGroup);
            const participants = meta.participants || [];
            const rawJids = participants.map(p => {
                if (p.phoneNumber) return `${p.phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;
                if (p.id && p.id.endsWith('@s.whatsapp.net')) return p.id.split(':')[0];
                if (p.lid) return p.lid.split(':')[0];
                return p.id ? p.id.split(':')[0] : null;
            }).filter(Boolean);

            const onProgress = async (done, total) => {
                if (statusMsg) {
                    await sock.sendMessage(chatId, {
                        text: `⏳ فحص: ${done}/${total}...`,
                        edit: statusMsg.key
                    }).catch(() => {});
                }
            };

            const { out, totalClean } = await getCompanions(sock, rawJids, onProgress);
            const rows = Object.entries(out).sort((a, b) => b[1].length - a[1].length);

            let report = `👥 *القروب:* ${meta.subject}\n🔌 *أجهزة مرتبطة:* ${rows.length}\n\n`;

            const mentions = [];
            if (rows.length === 0) {
                report += `✅ لا توجد أي أجهزة مرتبطة.`;
            } else {
                rows.forEach(([u, devs], i) => {
                    const userJid = `${u}@s.whatsapp.net`;
                    mentions.push(userJid);
                    report += `${i + 1}. 👤 @${u} ➔ 🔌 *الأجهزة:* ${devs.length}\n`;
                });
            }


            await sock.sendMessage(chatId, { text: report, mentions }, { quoted: m });
        } catch (err) {
            console.error('[Batch Devices Error]:', err);
            await sock.sendMessage(chatId, { text: `❌ فشل فحص القروب: ${err.message}` }, { quoted: m });
        }
    };

    activeSessions.set(chatId, { listener, timeout });
    sock.ev.on('messages.upsert', listener);
}

export default { NovaUltra, execute };