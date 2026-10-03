// ══════════════════════════════════════════════════════════════
//  join_requests.js — فحص وقبول طلبات الانضمام للقروبات
//  • .طلبات : فحص طلبات الانضمام المعلقة وكشف أجهزة أصحابها
//  • .قبول   : الموافقة على جميع طلبات الانضمام دفعة واحدة
// ══════════════════════════════════════════════════════════════

import { getBinaryNodeChild, getBinaryNodeChildren } from '@whiskeysockets/baileys';

const activeSessions = new Map();
let lastCheckedGroup = null;

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

async function getCompanions(sock, jids) {
    const out = {};
    const cleanJids = [...new Set(
        jids.map(j => {
            if (!j) return null;
            return j.replace(/:\d+@/, '@');
        }).filter(Boolean)
    )];

    const parts = chunk(cleanJids, 35);

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
            console.error('[Requests USync Error]:', e.message);
        }
        if (i < parts.length - 1) await sleep(1000);
    }

    const normalizedOut = {};
    for (const [user, set] of Object.entries(out)) {
        normalizedOut[user] = Array.from(set);
    }
    return normalizedOut;
}

async function fetchGroupRequests(sock, groupId) {
    try {
        const result = await sock.query({
            tag: 'iq',
            attrs: {
                type: 'get',
                xmlns: 'w:g2',
                to: groupId
            },
            content: [{ tag: 'membership_approval_requests', attrs: {} }]
        });

        const node = getBinaryNodeChild(result, 'membership_approval_requests');
        const children = getBinaryNodeChildren(node, 'membership_approval_request');

        if (Array.isArray(children)) {
            return children.map(c => ({
                jid: c.attrs?.jid,
                phoneNumber: c.attrs?.phone_number || c.attrs?.phoneNumber || c.attrs?.pn,
                ...(c.attrs || {})
            }));
        }
    } catch {}

    return await sock.groupRequestParticipantsList(groupId);
}

async function resolveRequestUser(sock, req, groupsList = []) {
    const rawJid = req.jid || '';
    const rawPn = req.phoneNumber || req.phone_number || req.pn || '';

    let phone = null;
    let lid = rawJid.endsWith('@lid') ? rawJid.replace(/:\d+@/, '@') : null;

    if (rawPn) {
        phone = rawPn.split('@')[0].split(':')[0].replace(/\D/g, '');
    } else if (rawJid.endsWith('@s.whatsapp.net')) {
        phone = rawJid.split('@')[0].split(':')[0].replace(/\D/g, '');
    }

    if (!phone && lid && Array.isArray(groupsList)) {
        const cleanLid = lid.replace(/:\d+@/, '@');
        for (const g of groupsList) {
            if (!g.participants) continue;
            const p = g.participants.find(x => (x.lid || '').replace(/:\d+@/, '@') === cleanLid);
            if (p) {
                if (p.phoneNumber) phone = p.phoneNumber.replace(/\D/g, '');
                else if (p.id && p.id.endsWith('@s.whatsapp.net')) phone = p.id.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (phone) break;
            }
        }
    }

    const queryJids = [];
    if (phone) queryJids.push(`${phone}@s.whatsapp.net`);
    if (lid && !queryJids.includes(lid)) queryJids.push(lid);
    if (rawJid && !queryJids.includes(rawJid)) queryJids.push(rawJid);

    return {
        phone,
        lid,
        approveJid: rawJid,
        mentionJid: phone ? `${phone}@s.whatsapp.net` : null,
        displayName: phone ? `@${phone}` : (lid ? `مستخدم (${lid.split('@')[0].slice(-6)})` : `@${rawJid.split('@')[0]}`),
        queryJids
    };
}

export const NovaUltra = {
    command:     ['طلبات', 'طلبات_القروب', 'قبول', 'قبول_الطلبات', 'requests', 'approve_requests'],
    description: 'فحص أجهزة أصحاب طلبات الانضمام في القروب والموافقة عليها سوا',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

export async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const senderRaw = msg.key.fromMe ? (sock.user?.id || chatId) : (msg.key.participant || chatId);
    const senderClean = (senderRaw || '').split(':')[0].split('@')[0].replace(/\D/g, '');
    const rawText = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
    const cmdUsed = rawText.split(/\s+/)[0].replace(/^[./#!]/, '').toLowerCase();

    const isAcceptCmd = ['قبول', 'قبول_الطلبات', 'approve_requests'].includes(cmdUsed);

    // إذا كان الأمر .قبول داخل القروب مباشرةً
    if (isAcceptCmd && chatId.endsWith('@g.us')) {
        return await handleApproveAll(sock, chatId, chatId, msg);
    }

    if (activeSessions.has(chatId)) {
        return sock.sendMessage(chatId, {
            text: '⏳ _لديك جلسة نشطة بالفعل. اختر رقماً أو اكتب *الغاء*._'
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: isAcceptCmd ? '⚡' : '📋', key: msg.key } }).catch(() => {});

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

    let menu = isAcceptCmd
        ? `✅ *اختر القروب للموافقة على طلبات انضمامه:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`
        : `📋 *اختر القروب لفحص طلبات الانضمام وأجهزتها:*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    groupsList.forEach((g, idx) => {
        menu += `*${idx + 1}.* ${g.subject || 'بدون اسم'} \`(👥 ${g.participants?.length || 0})\`\n`;
    });
    menu += `\n✍️ _أرسل رقم القروب (1-${groupsList.length}) أو اكتب *الغاء*._`;

    await sock.sendMessage(chatId, { text: menu }, { quoted: msg });

    const timeout = setTimeout(() => {
        clearSession(chatId, sock);
        sock.sendMessage(chatId, { text: '⏰ _انتهت مهلة اختيار القروب._' }).catch(() => {});
    }, 120_000);

    const listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        if (m.key.id === msg.key.id) return;

        const incomingSenderRaw = m.key.fromMe ? (sock.user?.id || chatId) : (m.key.participant || m.key.remoteJid);
        const incomingSenderClean = (incomingSenderRaw || '').split(':')[0].split('@')[0].replace(/\D/g, '');
        if (senderClean && incomingSenderClean !== senderClean) return;

        const txt = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();
        if (!txt) return;

        if (['الغاء', 'إلغاء', 'cancel', 'stop'].includes(txt.toLowerCase())) {
            clearSession(chatId, sock);
            return sock.sendMessage(chatId, { text: '✅ _تم إلغاء الجلسة._' }, { quoted: m });
        }

        const selectedIndex = parseInt(txt, 10);
        if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > groupsList.length) {
            return sock.sendMessage(chatId, {
                text: `⚠️ _يرجى اختيار رقم صحيح من 1 إلى ${groupsList.length}، أو اكتب *الغاء*._`
            }, { quoted: m });
        }

        clearSession(chatId, sock);
        const targetGroup = groupsList[selectedIndex - 1];
        lastCheckedGroup = targetGroup.id;

        if (isAcceptCmd) {
            await handleApproveAll(sock, targetGroup.id, chatId, m);
        } else {
            await handleInspectRequests(sock, targetGroup, chatId, m, groupsList);
        }
    };

    activeSessions.set(chatId, { listener, timeout });
    sock.ev.on('messages.upsert', listener);
}

// ── دالة فحص الطلبات والأجهزة ─────────────────────────────────
async function handleInspectRequests(sock, targetGroup, replyChatId, quotedMsg, groupsList = []) {
    const statusMsg = await sock.sendMessage(replyChatId, {
        text: `⏳ *جاري جلب وفحص طلبات الانضمام في:* \`${targetGroup.subject}\`...`
    }, { quoted: quotedMsg });

    try {
        let requests = [];
        try {
            requests = await fetchGroupRequests(sock, targetGroup.id);
        } catch (e) {
            return sock.sendMessage(replyChatId, {
                text: `❌ تعذر جلب الطلبات (تأكد أن البوت مشرف ولديه صلاحية إدارة الطلبات في القروب):\n${e.message}`,
                edit: statusMsg.key
            });
        }

        if (!requests || requests.length === 0) {
            return sock.sendMessage(replyChatId, {
                text: `📭 لا توجد أي طلبات انضمام معلقة في قروب:\n*${targetGroup.subject}*`,
                edit: statusMsg.key
            });
        }

        await sock.sendMessage(replyChatId, {
            text: `🔍 تم العثور على *${requests.length}* طلب. جاري فحص الأجهزة المرتبطة...`,
            edit: statusMsg.key
        }).catch(() => {});

        const resolvedUsers = [];
        const allQueryJids = [];

        for (const req of requests) {
            const user = await resolveRequestUser(sock, req, groupsList);
            resolvedUsers.push(user);
            allQueryJids.push(...user.queryJids);
        }

        const companionsMap = await getCompanions(sock, allQueryJids);

        const rows = [];
        const mentions = [];

        for (const u of resolvedUsers) {
            const phoneDevs = u.phone ? (companionsMap[u.phone] || []) : [];
            const lidDevs = u.lid ? (companionsMap[u.lid.split('@')[0]] || []) : [];
            const allDevs = new Set([...phoneDevs, ...lidDevs]);

            if (u.mentionJid && !mentions.includes(u.mentionJid)) mentions.push(u.mentionJid);

            rows.push({
                displayName: u.displayName,
                devicesCount: allDevs.size
            });
        }

        // ترتيب تنازلي حسب عدد الأجهزة
        rows.sort((a, b) => b.devicesCount - a.devicesCount);

        let report = `📋 *طلبات الانضمام المعلقة:*\n`;
        report += `👥 *القروب:* ${targetGroup.subject}\n`;
        report += `🔢 *إجمالي الطلبات:* ${rows.length}\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        rows.forEach((r, idx) => {
            const warnBadge = r.devicesCount > 0 ? ' ⚠️' : '';
            report += `*${idx + 1}.* 👤 ${r.displayName} ➔ 🔌 *الأجهزة:* ${r.devicesCount}${warnBadge}\n`;
        });

        report += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `💡 _للموافقة على جميع الطلبات سوا، أرسل:_ \`.قبول\``;

        await sock.sendMessage(replyChatId, {
            text: report,
            mentions
        }, { quoted: quotedMsg });

        await sock.sendMessage(replyChatId, { delete: statusMsg.key }).catch(() => {});

    } catch (err) {
        console.error('[Inspect Requests Error]:', err);
        await sock.sendMessage(replyChatId, {
            text: `❌ حدث خطأ أثناء فحص الطلبات: ${err.message}`,
            edit: statusMsg.key
        }).catch(() => {});
    }
}

// ── دالة قبول كافة الطلبات دفعة واحدة ────────────────────────
async function handleApproveAll(sock, groupId, replyChatId, quotedMsg) {
    const statusMsg = await sock.sendMessage(replyChatId, {
        text: `⏳ *جاري جلب الطلبات المعلقة للموافقة عليها...*`
    }, { quoted: quotedMsg });

    try {
        let requests = [];
        try {
            requests = await fetchGroupRequests(sock, groupId);
        } catch (e) {
            return sock.sendMessage(replyChatId, {
                text: `❌ تعذر جلب الطلبات. تأكد أن البوت مشرف بالقروب:\n${e.message}`,
                edit: statusMsg.key
            });
        }

        if (!requests || requests.length === 0) {
            return sock.sendMessage(replyChatId, {
                text: `📭 لا توجد أي طلبات انضمام معلقة للموافقة عليها.`,
                edit: statusMsg.key
            });
        }

        const jids = requests.map(r => r.jid).filter(Boolean);

        await sock.sendMessage(replyChatId, {
            text: `⏳ جاري قبول *${jids.length}* طلب انضمام دفعة واحدة...`,
            edit: statusMsg.key
        }).catch(() => {});

        const response = await sock.groupRequestParticipantsUpdate(groupId, jids, 'approve');

        await sock.sendMessage(replyChatId, {
            text: `✅ *تم قبول جميع طلبات الانضمام بنجاح!*\n👥 *العدد الإجمالي:* ${jids.length} عضو تم إدخالهم القروب.`,
            edit: statusMsg.key
        });

        await sock.sendMessage(replyChatId, { react: { text: '✅', key: quotedMsg.key } }).catch(() => {});
    } catch (err) {
        console.error('[Approve All Error]:', err);
        await sock.sendMessage(replyChatId, {
            text: `❌ فشل قبول الطلبات: ${err.message}`,
            edit: statusMsg.key
        }).catch(() => {});
    }
}

export default { NovaUltra, execute };