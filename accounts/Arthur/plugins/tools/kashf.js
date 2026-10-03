// ══════════════════════════════════════════════════════════════
//  kashf.js — أمر "كشف": فحص الأجهزة المرتبطة لشخص محدد
//  يدعم: الرد على الرسالة، المنشن، إدخال رقم، أو فحص المرسل
// ══════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const NovaUltra = {
    command:     ['كشف', 'اجهزة', 'كشف_جهاز', 'devices'],
    description: 'كشف الأجهزة المتصلة والمرتبطة لأعضاء القروب أو شخص محدد',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

function getContext(msg) {
    const root = msg?.message?.ephemeralMessage?.message 
              || msg?.message?.viewOnceMessage?.message 
              || msg?.message?.viewOnceMessageV2?.message 
              || msg?.message?.documentWithCaptionMessage?.message 
              || msg?.message;
    if (!root) return null;
    const type = Object.keys(root)[0];
    return root.extendedTextMessage?.contextInfo || root[type]?.contextInfo || null;
}

async function resolveTarget(sock, msg, args, sender) {
    const chatId = msg.key.remoteJid;
    const ctx = getContext(msg);
    const isQuoted = Boolean(ctx?.quotedMessage);
    let target = null;

    // إعطاء الأولوية للمنشن أولاً ثم الرد ثم الوسائط
    if (ctx?.mentionedJid?.[0]) {
        target = ctx.mentionedJid[0];
    } else if (isQuoted) {
        target = ctx?.participant || (chatId.endsWith('@s.whatsapp.net') ? chatId : null);
    } else if (ctx?.participant) {
        target = ctx.participant;
    } else if (typeof sock.replyedJid === 'function') {
        try {
            target = await sock.replyedJid(msg);
        } catch {}
    } else if (args && args[0]) {
        const digits = args[0].replace(/\D/g, '');
        if (digits.length >= 7 && digits.length <= 15) {
            const userJid = `${digits}@s.whatsapp.net`;
            return { phone: digits, jid: userJid, mentions: [userJid] };
        }
    }

    if (!target) {
        if (msg.key.fromMe) {
            target = sock.user?.id || sock.user?.jid;
        } else {
            target = msg.key.participant || msg.key.remoteJid;
        }
    }

    // تنظيف المعرف بدون حذف النطاق
    const cleanJid = String(target).replace(/:\d+@/, '@');
    const [userPart, domain] = cleanJid.split('@');
    const isLid = domain === 'lid';

    let phone = null;
    let lid = isLid ? cleanJid : null;

    if (!isLid && domain === 's.whatsapp.net') {
        phone = userPart.replace(/\D/g, '');
    }

    // إذا كان المعرف LID نبحث عن الرقم الحقيقي في أعضاء القروب
    if (isLid && chatId.endsWith('@g.us')) {
        try {
            const meta = await sock.groupMetadata(chatId);
            const p = meta.participants?.find(x => {
                const pLid = (x.lid || '').replace(/:\d+@/, '@');
                const pId = (x.id || '').replace(/:\d+@/, '@');
                return pLid === cleanJid || pId === cleanJid || pLid.split('@')[0] === userPart || pId.split('@')[0] === userPart;
            });
            if (p) {
                if (p.phoneNumber) phone = p.phoneNumber.replace(/\D/g, '');
                else if (p.id?.endsWith('@s.whatsapp.net')) phone = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (p.lid) lid = p.lid.replace(/:\d+@/, '@');
            }
        } catch {}
    }

    // في حال كان الهدف هو نفس البوت/المستخدم ولم نجد LID بعد
    if (!lid && (cleanJid === sock.user?.id?.replace(/:\d+@/, '@') || cleanJid === sock.user?.jid?.replace(/:\d+@/, '@'))) {
        lid = sock.user?.lid ? sock.user.lid.replace(/:\d+@/, '@') : null;
    }

    // محاولة جلب الـ LID عبر onWhatsApp إذا لم نجده حتى الآن
    if (!lid && phone) {
        try {
            const [info] = await sock.onWhatsApp(phone);
            if (info?.lid) {
                lid = info.lid.replace(/:\d+@/, '@');
            }
        } catch {}
    }

    if (!phone) {
        phone = userPart.replace(/\D/g, '');
    }

    const primaryJid = phone ? `${phone}@s.whatsapp.net` : cleanJid;
    const queryJids = [];
    if (phone) queryJids.push(`${phone}@s.whatsapp.net`);
    if (lid && !queryJids.includes(lid)) queryJids.push(lid);
    if (cleanJid && !queryJids.includes(cleanJid)) queryJids.push(cleanJid);
    if (target && typeof target === 'string' && !queryJids.includes(target)) queryJids.push(target);

    const mentions = phone ? [`${phone}@s.whatsapp.net`] : [primaryJid];

    return {
        phone,
        jid: primaryJid,
        lid: lid || null,
        mentions,
        queryJids
    };
}

async function execute({ sock, msg, args, sender }) {
    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const ctx = getContext(msg);
    const isQuoted = Boolean(ctx?.quotedMessage);
    const hasMention = Boolean(ctx?.mentionedJid?.length);
    const hasArgs = Boolean(args && args.some(a => a && a.trim().length > 0));
    const hasTargetParam = isQuoted || hasMention || hasArgs;

    // إذا تم تشغيل الأمر داخل القروب بدون تحديد شخص أو رد -> فحص أعضاء القروب الحالي
    if (isGroup && !hasTargetParam) {
        await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

        try {
            const meta = await sock.groupMetadata(chatId);
            const participants = meta.participants || [];
            const cleanJids = [...new Set(
                participants.map(p => {
                    let num = null;
                    if (p.phoneNumber) num = p.phoneNumber.replace(/\D/g, '');
                    else if (p.id && p.id.endsWith('@s.whatsapp.net')) num = p.id.split(':')[0].split('@')[0].replace(/\D/g, '');
                    return num ? `${num}@s.whatsapp.net` : null;
                }).filter(Boolean)
            )];

            const parts = chunk(cleanJids, 35);
            const out = {};

            for (let i = 0; i < parts.length; i++) {
                try {
                    const devices = await sock.getUSyncDevices(parts[i], false, false);
                    for (const d of (devices || [])) {
                        const devId = (typeof d?.device === 'number' && d.device > 0) ? d.device : (typeof d?.id === 'number' && d.id > 0 ? d.id : null);
                        if (devId !== null) {
                            const key = `${d.user}`;
                            if (!out[key]) out[key] = new Set();
                            out[key].add(devId);
                        }
                    }
                } catch (e) {
                    console.error('[Kashf USync Error]:', e.message);
                }
                if (i < parts.length - 1) await sleep(1000);
            }

            const rows = Object.entries(out)
                .map(([u, set]) => [u, Array.from(set)])
                .sort((a, b) => b[1].length - a[1].length);
            let report = `👥 *القروب:* ${meta.subject}\n🔌 *أجهزة مرتبطة:* ${rows.length}\n\n`;
            const mentions = [];

            if (rows.length === 0) {
                report += `✅ لا توجد أي أجهزة مرتبطة في هذا القروب.`;
            } else {
                rows.forEach(([u, devs], i) => {
                    const userJid = `${u}@s.whatsapp.net`;
                    mentions.push(userJid);
                    report += `${i + 1}. 👤 @${u} ➔ 🔌 *الأجهزة:* ${devs.length}\n`;
                });
            }

            await sock.sendMessage(chatId, { text: report, mentions }, { quoted: msg });
            await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});
            return;
        } catch (err) {
            await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
            return sock.sendMessage(chatId, { text: `❌ فشل فحص أعضاء القروب: ${err.message}` }, { quoted: msg });
        }
    }

    const resolved = await resolveTarget(sock, msg, args, sender);

    if (!resolved?.phone) {
        return sock.sendMessage(chatId, { text: '❌ تعذر تحديد الرقم.' }, { quoted: msg });
    }

    try {
        // الاستعلام بجميع المعرفات المتاحة (رقم الهاتف والـ LID) لجلب كافة الأجهزة بدقة تامة
        const targetsToQuery = resolved.queryJids?.length ? resolved.queryJids : [resolved.jid];
        const devices = await sock.getUSyncDevices(targetsToQuery, false, false);
        const companionList = new Set();
        for (const d of (devices || [])) {
            const devId = (typeof d?.device === 'number' && d.device > 0) ? d.device : (typeof d?.id === 'number' && d.id > 0 ? d.id : null);
            if (devId !== null) {
                companionList.add(devId);
            }
        }

        const report = `👤 *المستخدم:* @${resolved.phone}\n🔌 *الأجهزة المرتبطة:* ${companionList.size}`;

        await sock.sendMessage(chatId, {
            text: report,
            mentions: [`${resolved.phone}@s.whatsapp.net`]
        }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});
    } catch (err) {
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
        await sock.sendMessage(chatId, { text: `❌ حدث خطأ أثناء الكشف: ${err.message}` }, { quoted: msg });
    }
}

export default { NovaUltra, execute };