

// ══════════════════════════════════════════════════════════════
//  monitor_devices.js — أمر "راقب": مراقبة الأعضاء الجدد والأجهزة المرتبطة
//  ✅ يرصد من يدخل القروب ومعه جهاز مرتبط (بوت / واتساب ويب)
//  ✅ يطبع الأحداث داخل القروب المفعل فيه الأمر تلقائياً
//  ✅ يدعم إرسال نسخة من التنبيه بالخاص لرقم تحدده
//  ✅ يرصد إذا اتصل أي عضو بجهاز مرتبط جديد بعد دخوله ويكتفي بالتنبيه والعرض
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(process.cwd(), 'nova', 'data');
const CFG_FILE  = path.join(DATA_DIR, 'device_monitor.json');
const TARGET_REPORT_GROUP = '120363411553835005@g.us';

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
    try {
        return fs.existsSync(CFG_FILE) ? JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) : {};
    } catch {
        return {};
    }
}

function saveConfig(data) {
    try {
        fs.writeFileSync(CFG_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[MonitorConfig Save Error]:', e.message);
    }
}

const numOf = jid => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
let isListenerRegistered = false;
let periodicInterval = null;

async function checkUserCompanions(sock, phoneJid, lid) {
    try {
        const jids = [phoneJid];
        if (lid) jids.push(lid.endsWith('@lid') ? lid : `${lid}@lid`);
        const devices = await sock.getUSyncDevices(jids, false, false);
        const companions = new Set();
        for (const d of (devices || [])) {
            if (d && typeof d.device === 'number' && d.device > 0) {
                companions.add(d.device);
            } else if (d && typeof d.id === 'number' && d.id > 0) {
                companions.add(d.id);
            }
        }
        return Array.from(companions);
    } catch {
        return [];
    }
}

/**
 * تسجيل اللاقط العالمي لمراقبة الدخول الجديد وإرسال الرسائل عبر الأجهزة المرتبطة
 */
function registerGlobalMonitor(sock) {
    if (isListenerRegistered) return;
    isListenerRegistered = true;

    // 1. مراقبة الدخول الجديد للقروب
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action !== 'add') return;
        const config = loadConfig();
        const groupConf = config[id];
        if (!groupConf || !groupConf.enabled) return;

        for (const p of participants) {
            let pureNum = numOf(p);
            let lid = p.includes('@lid') ? p.split(':')[0] : null;
            try {
                const meta = await sock.groupMetadata(id);
                const part = meta.participants?.find(x => x.id === p || x.lid === p);
                if (part?.phoneNumber) pureNum = part.phoneNumber.replace(/\D/g, '');
                if (part?.lid) lid = part.lid.split(':')[0];
            } catch {}

            if (!pureNum) continue;
            const phoneJid = `${pureNum}@s.whatsapp.net`;

            // فحص أجهزة العضو المنضم فوراً
            const companions = await checkUserCompanions(sock, phoneJid, lid);
            groupConf.knownDevices = groupConf.knownDevices || {};
            groupConf.knownDevices[pureNum] = companions.length;
            saveConfig(config);

            if (companions.length > 0) {
                const alertText =
`🚨 *رصد جهاز مرتبط لعضو منضم!*
👤 *العضو:* @${pureNum}
🔌 *الأجهزة المرتبطة:* ${companions.length}`;

                await sock.sendMessage(TARGET_REPORT_GROUP, { text: alertText, mentions: [phoneJid] }).catch(() => {});
                if (id !== TARGET_REPORT_GROUP) {
                    await sock.sendMessage(id, { text: alertText, mentions: [phoneJid] }).catch(() => {});
                }
            }
        }
    });

    // 2. مراقبة ظهور أجهزة مرتبطة جديدة أثناء المحادثة
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m?.message || !m.key.remoteJid?.endsWith('@g.us')) return;

        const chatId = m.key.remoteJid;
        const config = loadConfig();
        const groupConf = config[chatId];
        if (!groupConf || !groupConf.enabled) return;

        const rawParticipant = m.key.participant || '';
        const senderNum = numOf(rawParticipant);
        if (!senderNum || m.key.fromMe) return;

        // Baileys يضع معرّف الجهاز في participant إذا كانت الرسالة من جهاز ثانوي (مثال: user:2@s.whatsapp.net)
        const hasCompanionDevice = rawParticipant.includes(':') && !rawParticipant.includes(':0@');
        let detectedDevice = null;
        if (hasCompanionDevice) {
            const match = rawParticipant.match(/:(\d+)@/);
            if (match && parseInt(match[1], 10) > 0) {
                detectedDevice = match[1];
            }
        }

        groupConf.knownDevices = groupConf.knownDevices || {};
        const previousCount = groupConf.knownDevices[senderNum];

        // إذا تم رصد جهاز جديد لم يكن موجوداً
        if (detectedDevice && (typeof previousCount === 'undefined' || previousCount === 0)) {
            groupConf.knownDevices[senderNum] = 1;
            saveConfig(config);

            const phoneJid = `${senderNum}@s.whatsapp.net`;
            const alertMsg =
`🚨 *رصد جهاز مرتبط جديد أثناء المحادثة!*
👤 *العضو:* @${senderNum}
🔌 *الجهاز المرتبط:* ${detectedDevice}`;

            await sock.sendMessage(TARGET_REPORT_GROUP, { text: alertMsg, mentions: [phoneJid] }).catch(() => {});
            if (chatId !== TARGET_REPORT_GROUP) {
                await sock.sendMessage(chatId, { text: alertMsg, mentions: [phoneJid] }).catch(() => {});
            }
        }
    });

    // 3. فحص دوري مستمر للأعضاء ورصد أي جهاز يربط جديد
    if (!periodicInterval) {
        periodicInterval = setInterval(async () => {
            const config = loadConfig();
            for (const [gid, gConf] of Object.entries(config)) {
                if (!gConf?.enabled) continue;
                try {
                    const meta = await sock.groupMetadata(gid).catch(() => null);
                    if (!meta?.participants) continue;
                    gConf.knownDevices = gConf.knownDevices || {};

                    for (const p of meta.participants) {
                        const num = p.phoneNumber ? p.phoneNumber.replace(/\D/g, '') : numOf(p.id);
                        if (!num) continue;
                        const prev = gConf.knownDevices[num] || 0;
                        const currentCompanions = await checkUserCompanions(sock, `${num}@s.whatsapp.net`, p.lid);
                        if (currentCompanions.length > prev) {
                            gConf.knownDevices[num] = currentCompanions.length;
                            saveConfig(config);
                            const alertMsg =
`🚨 *رصد ربط جهاز جديد عبر الفحص الدوري!*
👤 *العضو:* @${num}
🔌 *الأجهزة المرتبطة:* ${currentCompanions.length}`;
                            await sock.sendMessage(TARGET_REPORT_GROUP, {
                                text: alertMsg,
                                mentions: [`${num}@s.whatsapp.net`]
                            }).catch(() => {});
                        }
                    }
                } catch {}
            }
        }, 15 * 60 * 1000);
    }
}

const NovaUltra = {
    command:     ['راقب', 'مراقبة', 'رصد_البوتات', 'monitor'],
    description: 'تفعيل مراقبة القروب للأجهزة المرتبطة وعرض تنبيهات الدخول والاتصال',
    elite:       'off',
    group:       true,
    prv:         false,
    lock:        'off',
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    registerGlobalMonitor(sock);

    const config = loadConfig();
    if (!config[chatId]) {
        config[chatId] = {
            enabled: false,
            privateAlert: null,
            knownDevices: {}
        };
    }

    const sub = (args[0] || '').trim();

    // ── حالة المراقبة ─────────────────────────────────────────
    if (sub === 'حالة') {
        const c = config[chatId];
        return sock.sendMessage(chatId, {
            text:
`🛡️ *حالة نظام المراقبة في القروب:*
━━━━━━━━━━━━━━━━━━━━━━
📡 *المراقبة:* ${c.enabled ? 'مفعلة ✅' : 'معطلة ⛔'}
📩 *التنبيه بالخاص:* ${c.privateAlert ? `\`+${numOf(c.privateAlert)}\` ✅` : 'غير محدد ❌'}

⚙️ *أوامر التحكم:*
• \`.راقب\` ➔ تشغيل / إيقاف المراقبة
• \`.راقب خاص <رقم>\` ➔ تعيين رقم خاص لإرسال التنبيهات إليه
• \`.راقب خاص الغاء\` ➔ إلغاء التنبيه بالخاص`
        }, { quoted: msg });
    }

    // ── تحديد رقم التنبيه في الخاص ───────────────────────────
    if (sub === 'خاص') {
        const targetNum = (args[1] || '').replace(/\D/g, '');
        if (args[1] === 'الغاء' || args[1] === 'إلغاء') {
            config[chatId].privateAlert = null;
            saveConfig(config);
            return sock.sendMessage(chatId, { text: '✅ _تم إلغاء إرسال التنبيهات للخاص._' }, { quoted: msg });
        }
        if (!targetNum || targetNum.length < 7) {
            return sock.sendMessage(chatId, {
                text: '⚠️ _يرجى كتابة رقم الهاتف مع كود الدولة._\n_مثال:_ \`.راقب خاص 966501234567\`\n_أو للإلغاء:_ \`.راقب خاص الغاء\`'
            }, { quoted: msg });
        }
        config[chatId].privateAlert = `${targetNum}@s.whatsapp.net`;
        saveConfig(config);
        return sock.sendMessage(chatId, {
            text: `✅ *تم تعيين رقم التنبيه الخاص:* \`+${targetNum}\`\n_ستصلك نسخة من كشف الأجهزة المرتبطة في الخاص مباشرة._`
        }, { quoted: msg });
    }

    // ── تبديل تشغيل/إيقاف المراقبة الأساسية ───────────────────
    config[chatId].enabled = !config[chatId].enabled;
    saveConfig(config);

    if (config[chatId].enabled) {
        return sock.sendMessage(chatId, {
            text:
`🛡️ *تم تفعيل نظام مراقبة الأجهزة المرتبطة بنجاح!*
━━━━━━━━━━━━━━━━━━━━━━
📍 *القروب المراقب:* هذا القروب هو مركز الإشعارات والطباعة.
🔍 *سيرصد النظام:*
1. أي عضو جديد يدخل القروب ومعه جهاز مرتبط (واتساب ويب / بوت).
2. أي عضو يتصل بجهاز ثانوي بعد دخوله القروب.

📩 _لتلقي التنبيهات في الخاص أيضاً:_\n\`.راقب خاص <رقمك>\``
        }, { quoted: msg });
    } else {
        return sock.sendMessage(chatId, {
            text: '⛔ *تم إيقاف نظام المراقبة في هذا القروب.*'
        }, { quoted: msg });
    }
}

export default { NovaUltra, execute };