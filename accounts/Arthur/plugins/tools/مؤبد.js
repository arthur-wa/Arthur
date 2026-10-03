// ══════════════════════════════════════════════════════════════
//  مؤبد.js — المؤبد: طرد صامت وفوري للمحظورين (Baileys)
// ══════════════════════════════════════════════════════════════

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../nova/data');
const BANLIST_FILE = path.join(DATA_DIR, 'banlist.json');

fs.ensureDirSync(DATA_DIR);

// ── إعدادات ─────────────────────────────────────────────────
const CONFIG = {
    KICK_DELAY_MS: 400,            // تأخير بين عمليات الطرد المتتالية (حماية من الحظر)
    STARTUP_SWEEP_DELAY_MS: 8000,  // مسح كل القروبات مرة وحدة بعد أول اتصال للبوت
    SKIP_ADMINS: true,             // لا يطرد المشرفين
    MATCH_PUSHNAME: false,         // مطابقة اليوزر مع اسم العرض (قد يعطي طرد خاطئ، الأفضل false)
};

const DEFAULT_BANLIST = { numbers: ['79246099555'], usernames: [], lids: [] };

// ── أدوات مساعدة ────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const baseJid = (j) => String(j || '').replace(/:\d+@/, '@');
const isPnJid = (j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net');
const isLidJid = (j) => typeof j === 'string' && j.endsWith('@lid');
const pnFromJid = (j) => digits(String(j).split('@')[0].split(':')[0]);
const normUser = (u) => {
    const c = String(u ?? '').trim().replace(/^@/, '').toLowerCase();
    return c ? `@${c}` : '';
};
const isAdminP = (p) => p?.admin === 'admin' || p?.admin === 'superadmin';

// ── إدارة banlist.json (مع كاش في الذاكرة) ───────────────────
let cache = null;
let lastCheck = 0;
let lastMtime = 0;

function cleanRaw(data = {}) {
    return {
        numbers: [...new Set((data.numbers || []).map(digits).filter(Boolean))],
        usernames: [...new Set((data.usernames || []).map(normUser).filter(Boolean))],
        lids: [...new Set((data.lids || []).map(baseJid).filter(isLidJid))],
    };
}

function buildCache(raw) {
    return {
        raw,
        numbers: new Set(raw.numbers),
        usernames: new Set(raw.usernames),
        lids: new Set(raw.lids),
        empty: !raw.numbers.length && !raw.usernames.length && !raw.lids.length,
    };
}

function saveBanlist(data) {
    const raw = cleanRaw(data);
    fs.writeJsonSync(BANLIST_FILE, raw, { spaces: 2 });
    try { lastMtime = fs.statSync(BANLIST_FILE).mtimeMs; } catch {}
    cache = buildCache(raw);
    lastCheck = Date.now();
    return cache;
}

function loadBanlist() {
    const now = Date.now();
    if (cache && now - lastCheck < 5000) return cache;
    lastCheck = now;
    try {
        if (!fs.existsSync(BANLIST_FILE)) return saveBanlist(DEFAULT_BANLIST);
        const mtime = fs.statSync(BANLIST_FILE).mtimeMs;
        if (cache && mtime === lastMtime) return cache;
        lastMtime = mtime;
        cache = buildCache(cleanRaw(fs.readJsonSync(BANLIST_FILE)));
    } catch (e) {
        console.error('[مؤبد] خطأ في قراءة banlist.json:', e.message);
        if (!cache) cache = buildCache(cleanRaw(DEFAULT_BANLIST));
    }
    return cache;
}

// ── هوية العضو (أرقام / LID / يوزرات) ───────────────────────
async function getIdentity(sock, p, pushName) {
    const o = typeof p === 'string' ? { id: p } : (p || {});
    const phones = new Set();
    const lids = new Set();
    const names = new Set();

    for (const j of [o.id, o.jid, o.phoneNumber]) {
        if (!j) continue;
        if (isPnJid(j)) phones.add(pnFromJid(j));
        else if (isLidJid(j)) lids.add(baseJid(j));
        else if (/^\+?\d{7,}$/.test(String(j))) phones.add(digits(j));
    }
    if (o.lid) lids.add(baseJid(o.lid));

    // لو عندنا LID بس، نحاول نجيب الرقم الحقيقي
    if (!phones.size && lids.size) {
        for (const lid of lids) {
            try {
                const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lid);
                if (pn) { phones.add(pnFromJid(pn)); break; }
            } catch {}
        }
    }

    for (const u of [o.username, o.user_name]) if (u) names.add(normUser(u));
    if (CONFIG.MATCH_PUSHNAME && pushName) names.add(normUser(pushName));

    phones.delete('');
    names.delete('');
    return { id: o.id || o.jid || '', phones: [...phones], lids: [...lids], names: [...names] };
}

function matchBan(idn) {
    const bl = loadBanlist();
    if (bl.empty) return null;
    for (const ph of idn.phones) if (bl.numbers.has(ph)) return { type: 'number', value: ph };
    for (const l of idn.lids) if (bl.lids.has(l)) return { type: 'lid', value: l };
    for (const u of idn.names) if (bl.usernames.has(u)) return { type: 'username', value: u };
    return null;
}

function getBotParticipant(sock, meta) {
    const mine = new Set([baseJid(sock.user?.id), baseJid(sock.user?.lid)].filter(Boolean));
    return meta?.participants?.find((p) =>
        [p.id, p.lid, p.jid, p.phoneNumber].some((x) => x && mine.has(baseJid(x)))
    );
}

// ── الطرد الصامت ────────────────────────────────────────────
const recentKicks = new Map();

async function kick(sock, chatId, jid) {
    const key = `${chatId}|${jid}`;
    const now = Date.now();
    if (recentKicks.size > 500) {
        for (const [k, t] of recentKicks) if (now - t > 30000) recentKicks.delete(k);
    }
    const last = recentKicks.get(key);
    if (last && now - last < 30000) return false;
    recentKicks.set(key, now);
    try {
        await sock.groupParticipantsUpdate(chatId, [jid], 'remove');
        return true;
    } catch (e) {
        console.error(`[مؤبد] تعذر طرد ${jid} من ${chatId}: ${e?.message}`);
        return false;
    }
}

async function processGroup(sock, meta) {
    if (!meta?.participants?.length || loadBanlist().empty) return 0;
    const me = getBotParticipant(sock, meta);
    if (!isAdminP(me)) return 0;

    let kicked = 0;
    for (const p of meta.participants) {
        if (p === me) continue;
        if (CONFIG.SKIP_ADMINS && isAdminP(p)) continue;
        const idn = await getIdentity(sock, p);
        if (!matchBan(idn)) continue;
        await sleep(CONFIG.KICK_DELAY_MS);
        if (await kick(sock, meta.id, p.id)) kicked++;
    }
    return kicked;
}

let sweeping = false;
let sweepPending = false;

async function sweepAll(sock) {
    if (!sock?.user) return;
    if (sweeping) { sweepPending = true; return; }
    sweeping = true;
    try {
        do {
            sweepPending = false;
            const groups = await sock.groupFetchAllParticipating();
            for (const meta of Object.values(groups || {})) {
                try { await processGroup(sock, meta); }
                catch (e) { console.error('[مؤبد] خطأ في مسح قروب:', e.message); }
                await sleep(200);
            }
        } while (sweepPending);
    } catch (e) {
        console.error('[مؤبد] خطأ في المسح الشامل:', e.message);
    } finally {
        sweeping = false;
    }
}

// ── الحراسة التلقائية ───────────────────────────────────────
async function onParticipantsUpdate(sock, { id: chatId, participants, action }) {
    try {
        if (action !== 'add' || !chatId?.endsWith('@g.us')) return;
        if (loadBanlist().empty) return;

        let meta = null;
        for (const raw of participants || []) {
            let idn = await getIdentity(sock, raw);
            let hit = matchBan(idn);

            // لو ما قدرنا نعرف الرقم من الحدث، نجيب بيانات القروب
            if (!hit && !idn.phones.length) {
                meta ??= await sock.groupMetadata(chatId).catch(() => null);
                const rec = meta?.participants?.find((p) =>
                    baseJid(p.id) === baseJid(idn.id) ||
                    (p.lid && idn.lids.includes(baseJid(p.lid)))
                );
                if (rec) { idn = await getIdentity(sock, rec); hit = matchBan(idn); }
            }

            if (hit) await kick(sock, chatId, idn.id);
        }
    } catch (e) {
        console.error('[مؤبد] خطأ في حدث الانضمام:', e.message);
    }
}

async function onMessages(sock, { messages, type }) {
    if (type !== 'notify' || loadBanlist().empty) return;
    for (const m of messages || []) {
        try {
            const chatId = m?.key?.remoteJid;
            if (!chatId?.endsWith('@g.us') || m.key.fromMe) continue;
            const senderJid = m.key.participant;
            if (!senderJid) continue;

            const idn = await getIdentity(
                sock,
                { id: senderJid, jid: m.key.participantAlt || m.key.participantPn },
                m.pushName
            );
            if (!matchBan(idn)) continue;

            const meta = await sock.groupMetadata(chatId).catch(() => null);
            if (!meta) continue;
            if (!isAdminP(getBotParticipant(sock, meta))) continue;

            const rec = meta.participants?.find((p) => baseJid(p.id) === baseJid(senderJid));
            if (CONFIG.SKIP_ADMINS && isAdminP(rec)) continue;

            await kick(sock, chatId, rec?.id || senderJid);
        } catch (e) {
            console.error('[مؤبد] خطأ في مراقبة الرسائل:', e.message);
        }
    }
}

// ── التفعيل عند تشغيل البوت ─────────────────────────────────
const initialized = new WeakSet();
let startupSwept = false;

export function init(sock) {
    if (!sock?.ev || initialized.has(sock)) return;
    initialized.add(sock);
    loadBanlist();

    sock.ev.on('group-participants.update', (u) => onParticipantsUpdate(sock, u));
    sock.ev.on('messages.upsert', (u) => onMessages(sock, u));
    sock.ev.on('groups.upsert', async (groups) => {
        for (const g of groups || []) await processGroup(sock, g).catch(() => {});
    });

    // مسح شامل مرة وحدة فقط عند تشغيل البوت، وبعدها الحراسة بالأحداث فقط
    const startupSweep = (delay) => {
        if (startupSwept) return;
        startupSwept = true;
        setTimeout(() => sweepAll(sock), delay);
    };
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') startupSweep(CONFIG.STARTUP_SWEEP_DELAY_MS);
    });
    // لو الاتصال مفتوح أصلاً وقت الاستدعاء
    if (sock.user) startupSweep(1500);
    console.log('[مؤبد] تم تفعيل الحراسة التلقائية الصامتة');
}

// ── بيانات الأمر ────────────────────────────────────────────
export const NovaUltra = {
    command:     ['مؤبد', 'المؤبد', 'الغاء_مؤبد', 'فك_مؤبد'],
    description: 'إدارة قائمة المؤبد والطرد التلقائي الصامت للأعضاء المحظورين',
    elite:       'off',
    group:       true,
    prv:         false,
    lock:        'off',
};

const react = (sock, msg, emoji) =>
    sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {});

export async function execute({ sock, msg, sender, args = [], usedPrefix = '.' }) {
    init(sock); // احتياط: يضمن التفعيل حتى لو ما انستدعى وقت التشغيل

    const chatId = msg.key.remoteJid;
    const meta = await sock.groupMetadata(chatId).catch(() => null);
    if (!meta) return;

    args = [...args];
    const rawText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const cmdCalled = rawText.trim().split(/\s+/)[0].replace(usedPrefix, '');
    let isUnban = ['الغاء_مؤبد', 'فك_مؤبد'].includes(cmdCalled);

    // ── الصلاحيات: أدمن أو مالك ──
    const senderJid = msg.key.participant || chatId;
    const senderRec = meta.participants?.find((p) => baseJid(p.id) === baseJid(senderJid));
    const senderIdn = await getIdentity(sock, senderRec || { id: senderJid, jid: msg.key.participantAlt });
    const ownerNum = digits(global.config?.owner);
    const isOwner = Boolean(
        msg.key.fromMe ||
        (ownerNum && (senderIdn.phones.includes(ownerNum) || digits(sender?.pn) === ownerNum))
    );
    if (!(isOwner || isAdminP(senderRec))) {
        await react(sock, msg, '⛔');
        return sock.sendMessage(chatId, { text: '❌ *هذا الأمر متاح فقط لمشرفي القروب أو مالك البوت.*' }, { quoted: msg });
    }

    // ── عرض القائمة ──
    if (['قائمة', 'القائمة'].includes(args[0])) {
        const bl = loadBanlist().raw;
        const tail = (a) => a.slice(-15).map((x, i) => `${i + 1}. ${x}`).join('\n') || '—';
        const text =
            `📋 *قائمة المؤبد*\n📱 الأرقام: ${bl.numbers.length}\n👤 اليوزرات: ${bl.usernames.length}\n\n` +
            `*آخر الأرقام المضافة:*\n${tail(bl.numbers.map((n) => `+${n}`))}\n\n` +
            `*آخر اليوزرات:*\n${tail(bl.usernames)}\n\n📁 القائمة الكاملة في banlist.json`;
        return sock.sendMessage(chatId, { text }, { quoted: msg });
    }

    if (['الغاء', 'فك', 'حذف'].includes(args[0])) {
        isUnban = true;
        args.shift();
    }

    // ── استخراج الأهداف: رد / منشن / أرقام / يوزرات (يدعم أكثر من هدف) ──
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const found = { numbers: new Set(), usernames: new Set(), lids: new Set() };

    const jids = [ctx?.participant, ...(ctx?.mentionedJid || [])].filter(Boolean);
    for (const j of jids) {
        const rec = meta.participants?.find((p) => baseJid(p.id) === baseJid(j));
        const idn = await getIdentity(sock, rec || { id: j });
        idn.phones.forEach((x) => found.numbers.add(x));
        idn.lids.forEach((x) => found.lids.add(x));
    }

    for (const tok of args.join(' ').split(/[\s,،;]+/).filter(Boolean)) {
        if (/^@\d+$/.test(tok) && ctx?.mentionedJid?.length) continue; // منشن معالج أعلاه
        if (/^\+?[\d\-().]{7,}$/.test(tok)) {
            const d = digits(tok);
            if (d.length >= 7 && d.length <= 15) found.numbers.add(d);
        } else if (/^@?[A-Za-z0-9._]{2,32}$/.test(tok)) {
            found.usernames.add(normUser(tok));
        }
    }

    // حماية: لا نضيف البوت أو المالك
    const botNum = digits(String(sock.user?.id || '').split(':')[0].split('@')[0]);
    if (botNum) found.numbers.delete(botNum);
    if (ownerNum) found.numbers.delete(ownerNum);
    found.lids.delete(baseJid(sock.user?.lid));

    const total = found.numbers.size + found.usernames.size + found.lids.size;
    if (!total) {
        return sock.sendMessage(chatId, {
            text: `📌 *طريقة الاستخدام:*\n` +
                  `• \`${usedPrefix}مؤبد 201234567890\`\n` +
                  `• \`${usedPrefix}مؤبد @username\`\n` +
                  `• أكثر من هدف: \`${usedPrefix}مؤبد 2012... 2126... @user\`\n` +
                  `• بالرد على رسالة الشخص أو منشن\n` +
                  `• للإلغاء: \`${usedPrefix}الغاء_مؤبد 201234567890\`\n` +
                  `• للعرض: \`${usedPrefix}مؤبد قائمة\``
        }, { quoted: msg });
    }

    const current = loadBanlist().raw;

    // ── إلغاء المؤبد ──
    if (isUnban) {
        const next = {
            numbers: current.numbers.filter((n) => !found.numbers.has(n)),
            usernames: current.usernames.filter((u) => !found.usernames.has(u)),
            lids: current.lids.filter((l) => !found.lids.has(l)),
        };
        const removed =
            (current.numbers.length - next.numbers.length) +
            (current.usernames.length - next.usernames.length) +
            (current.lids.length - next.lids.length);
        if (removed) saveBanlist(next);
        return react(sock, msg, removed ? '🔓' : '⚠️');
    }

    // ── إضافة مؤبد (يحفظ + يطرد من كل القروبات فوراً وبصمت) ──
    saveBanlist({
        numbers: [...current.numbers, ...found.numbers],
        usernames: [...current.usernames, ...found.usernames],
        lids: [...current.lids, ...found.lids],
    });
    await react(sock, msg, '⚖️');
    sweepAll(sock); // بدون await عشان الرد ما يتأخر
}

export default { NovaUltra, execute, init };
