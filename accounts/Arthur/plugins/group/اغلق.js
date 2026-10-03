
import fs from 'fs';
import path from 'path';

const dataDir  = path.join(process.cwd(), 'nova', 'data');
const featPath = path.join(dataDir, 'features.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadF() {
    try { return JSON.parse(fs.readFileSync(featPath, 'utf8')); }
    catch { return { groups: {}, antiPrivate: false }; }
}
function saveF(d) {
    try { fs.writeFileSync(featPath, JSON.stringify(d, null, 2), 'utf8'); } catch {}
}
function getGroup(d, gid) {
    if (!d.groups) d.groups = {};
    if (!d.groups[gid]) d.groups[gid] = { warns: {}, warnLimit: 3, welcome: '', goodbye: '' };
    return d.groups[gid];
}

function getMentioned(msg) {
    return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}
function getQuotedSender(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    return ctx?.participant || ctx?.remoteJid || null;
}
async function isAdmin(sock, chatId, jid) {
    try {
        const meta = await sock.groupMetadata(chatId);
        const norm = jid.replace(/:\d+/, '');
        return meta.participants.some(p => p.id.replace(/:\d+/, '') === norm && (p.admin === 'admin' || p.admin === 'superadmin'));
    } catch { return false; }
}
async function isBotAdmin(sock, chatId) {
    try {
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        return await isAdmin(sock, chatId, botJid);
    } catch { return false; }
}
function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}

const NovaUltra = { command: ['اغلق'], description: 'إغلاق المجموعة', elite: 'off', group: true, prv: false, lock: 'off' };

function msParser(str) {
    const m = str.match(/^(\d+)([smhd])$/i);
    if (!m) return null;
    const n = parseInt(m[1]), u = m[2].toLowerCase();
    return { s:n*1000, m:n*60000, h:n*3600000, d:n*86400000 }[u] || null;
}
function clockStr(ms) {
    const d=Math.floor(ms/86400000),h=Math.floor(ms/3600000)%24,m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;
    return [d&&`${d} يوم`,h&&`${h} ساعة`,m&&`${m} دقيقة`,s&&`${s} ثانية`].filter(Boolean).join(' ');
}

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    if (!await isAdmin(sock, chatId, senderJid)) return reply(sock, chatId, '❌ هذا الأمر للمشرفين فقط.', msg);
    try {
        const meta = await sock.groupMetadata(chatId);
        if (meta.announce) return reply(sock, chatId, '《✧》 المجموعة مغلقة بالفعل.', msg);
        const timeout = args[0] ? msParser(args[0]) : 0;
        if (args[0] && !timeout) return reply(sock, chatId, '❌ صيغة غير صحيحة. مثال: 10s أو 5m أو 2h أو 1d', msg);
        if (timeout > 0) {
            await reply(sock, chatId, `❀ سيتم إغلاق المجموعة بعد ${clockStr(timeout)}.`, msg);
            setTimeout(async () => {
                try { const md = await sock.groupMetadata(chatId); if (!md.announce) { await sock.groupSettingUpdate(chatId, 'announcement'); await reply(sock, chatId, '✿ تم إغلاق المجموعة.', msg); } } catch {}
            }, timeout);
        } else {
            await sock.groupSettingUpdate(chatId, 'announcement');
            await reply(sock, chatId, '✿ تم إغلاق المجموعة بنجاح.', msg);
        }
    } catch (e) { reply(sock, chatId, `❌ خطأ: ${e.message}`, msg); }
}

export default { NovaUltra, execute };
