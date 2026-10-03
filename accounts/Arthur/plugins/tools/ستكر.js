// ══════════════════════════════════════════════════════════════
//  ستكر.js — تحويل ستكرات تيليجرام → واتساب
//  ✅ كشف نوع الملف من البايتات (magic bytes) — لا يعتمد على API flags
//  ✅ WebP ثابت  → sharp مباشرة
//  ✅ WebM متحرك → ffmpeg → WebP متحرك
//  ✅ TGS (Lottie gzip) → ffmpeg → WebP متحرك
//  ✅ fallback: إرسال كـ فيديو/صورة لو ffmpeg غير موجود
// ══════════════════════════════════════════════════════════════

import axios  from 'axios';
import sharp  from 'sharp';
import { exec }       from 'child_process';
import { promisify }  from 'util';
import fs   from 'fs/promises';
import path from 'path';
import os   from 'os';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
const execAsync = promisify(exec);

export const NovaUltra = {
    command:     ['ستكر', 'sticker', 'ستيكر', 'stkr'],
    description: 'يحوّل حزم ستكرات تيليجرام إلى ستكرات واتساب',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

// ══════════════════════════════════════════════════════════════
//  🔑 التوكن
//  احصل عليه من @BotFather في تيليجرام
//  ثم أضف في .env:  TELEGRAM_BOT_TOKEN=توكنك
// ══════════════════════════════════════════════════════════════
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8924356522:AAHqmA33uk_oGD79V4og3HU4kGU_pNszaRs';
const TG_API      = () => `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const TG_FILE_API = () => `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}`;

const MAX_STICKERS = 30;
const SEND_DELAY   = 250;

// ══════════════════════════════════════════════════════════════
//  🔍 كشف نوع الملف من Magic Bytes
//  هذا هو جوهر الإصلاح — لا نثق بـ API flags
// ══════════════════════════════════════════════════════════════
function detectMimeType(buf) {
    if (!buf || buf.length < 12) return 'unknown';

    // WebP: RIFF????WEBP
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
        // تحقق إن كانت متحركة (ANIM chunk) أم ثابتة
        const isAnimated = buf.indexOf(Buffer.from('ANIM')) !== -1;
        return isAnimated ? 'webp-animated' : 'webp-static';
    }

    // GZip → TGS (Lottie)
    if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tgs';

    // WebM / MKV
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';

    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';

    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';

    // MP4 / MOV (ftyp box)
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'mp4';

    return 'unknown';
}

// ══════════════════════════════════════════════════════════════
//  التحقق من وجود ffmpeg
// ══════════════════════════════════════════════════════════════
let _ffmpegAvailable = null;
async function hasFfmpeg() {
    if (_ffmpegAvailable !== null) return _ffmpegAvailable;
    try {
        await execAsync('ffmpeg -version 2>/dev/null');
        _ffmpegAvailable = true;
    } catch {
        _ffmpegAvailable = false;
    }
    return _ffmpegAvailable;
}

// ══════════════════════════════════════════════════════════════
//  معالجة الصور حسب النوع
// ══════════════════════════════════════════════════════════════

/** WebP ثابت → resize 512×512 */
async function processStaticWebp(buf) {
    return sharp(buf)
        .resize(512, 512, {
            fit:        'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 25 })
        .toBuffer();
}

/** PNG / GIF ثابت → WebP */
async function processStaticImage(buf) {
    return sharp(buf)
        .resize(512, 512, {
            fit:        'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 50 })
        .toBuffer();
}

/** WebP متحرك → بدون معالجة (واتساب يقبله مباشرة) */
async function processAnimatedWebp(buf) {
    // واتساب يقبل WebP متحرك مباشرة — نعيد البفر كما هو
    // لكن نضمن الحجم المناسب عبر ffmpeg لو كان متاحاً
    if (await hasFfmpeg()) {
        return await ffmpegConvertToWebp(buf, 'webp');
    }
    return buf; // إرسال مباشر بدون تحويل
}

/** WebM / MP4 → WebP متحرك عبر ffmpeg */
async function processVideoToWebp(buf, ext = 'webm') {
    if (!await hasFfmpeg()) {
        throw new Error('ffmpeg غير مثبت — لا يمكن تحويل الستكرات المتحركة');
    }
    return ffmpegConvertToWebp(buf, ext);
}

/** TGS (Lottie gzip) → WebP متحرك عبر ffmpeg */
async function processTgsToWebp(buf) {
    if (!await hasFfmpeg()) {
        throw new Error('ffmpeg غير مثبت — لا يمكن تحويل TGS');
    }

    const tmp    = await fs.mkdtemp(path.join(os.tmpdir(), 'tgs-'));
    const tgPath = path.join(tmp, 'in.tgs');
    const gifPth = path.join(tmp, 'out.gif');
    const webpPt = path.join(tmp, 'out.webp');

    try {
        await fs.writeFile(tgPath, buf);

        // فك الضغط gzip للحصول على JSON اللوتي
        await execAsync(`zcat "${tgPath}" > "${gifPth}" 2>/dev/null`)
            .catch(() => {/* لو فشل نكمل */});

        // محاولة lottie_convert.py (اختياري)
        const hasPy = await execAsync('which lottie_convert.py 2>/dev/null')
            .then(() => true).catch(() => false);
        if (hasPy) {
            await execAsync(`lottie_convert.py "${tgPath}" "${gifPth}" 2>/dev/null`).catch(() => {});
        }

        await execAsync(
            `ffmpeg -i "${gifPth}" ` +
            `-vf "scale=512:512:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15" ` +
            `-vcodec libwebp -lossless 0 -q:v 75 -loop 0 -an -vsync 0 "${webpPt}" -y 2>/dev/null`
        );
        return await fs.readFile(webpPt);
    } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

/** تحويل عام عبر ffmpeg */
async function ffmpegConvertToWebp(buf, inExt) {
    const tmp    = await fs.mkdtemp(path.join(os.tmpdir(), 'tgconv-'));
    const inPath = path.join(tmp, `in.${inExt}`);
    const outPth = path.join(tmp, 'out.webp');

    try {
        await fs.writeFile(inPath, buf);
        await execAsync(
            `ffmpeg -i "${inPath}" ` +
            `-vf "scale=512:512:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=30" ` +
            `-vcodec libwebp -lossless 0 -q:v 30 -loop 0 -an -vsync 0 -vf "scale=256:256:force_original_aspect_ratio=decrease,pad=256:256:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15" "${outPth}" -y 2>/dev/null`
        );
        return await fs.readFile(outPth);
    } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

// ══════════════════════════════════════════════════════════════
//  💠 إضافة ميتاداتا (حقوق) للستكر عبر wa-sticker-formatter
//  Pack Name : © ⍴᥆ᥕᥱrᥱძ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛
//  Author    : © mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛
//  ملاحظة: محاط بـ try/catch — لو فشل يُرجع البفر الأصلي بدون توقف
// ══════════════════════════════════════════════════════════════
async function addStickerMetadata(buf, animated = false) {
    try {
        const sticker = new Sticker(buf, {
            pack:    '© ⍴᥆ᥕᥱrᥱძ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛',
            author:  '© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛',
            type:    animated ? StickerTypes.FULL : StickerTypes.FULL,
            quality: 80,
        });
        return await sticker.toBuffer();
    } catch (metaErr) {
        console.warn('[ستكر/metadata]', metaErr?.message?.slice(0, 80));
        return buf; // أعد البفر الأصلي لو فشلت إضافة الميتاداتا
    }
}

// ══════════════════════════════════════════════════════════════
//  إرسال ستكر أو fallback (صورة/فيديو) لو التحويل تعذر
// ══════════════════════════════════════════════════════════════
async function sendSticker(sock, chatId, rawBuf, mimeType, quotedMsg) {
    let stickerBuf  = null;
    let usedFallback = false;

    // تحديد ما إذا كان الستكر متحركاً لتمريره لـ addStickerMetadata
    const isAnimatedType = ['webp-animated', 'webm', 'mp4', 'tgs', 'gif'].includes(mimeType);

    try {
        switch (mimeType) {
            case 'webp-static':
                stickerBuf = await processStaticWebp(rawBuf);
                break;
            case 'webp-animated':
                stickerBuf = await processAnimatedWebp(rawBuf);
                break;
            case 'webm':
            case 'mp4':
                stickerBuf = await processVideoToWebp(rawBuf, mimeType);
                break;
            case 'tgs':
                stickerBuf = await processTgsToWebp(rawBuf);
                break;
            case 'gif':
            case 'png':
                stickerBuf = await processStaticImage(rawBuf);
                break;
            default:
                // نوع مجهول → جرب sharp مباشرة
                try {
                    stickerBuf = await processStaticWebp(rawBuf);
                } catch {
                    usedFallback = true;
                }
        }
    } catch (convErr) {
        console.warn('[ستكر/conv]', mimeType, convErr?.message?.slice(0, 60));
        usedFallback = true;
    }

    if (stickerBuf) {
        // ── إضافة الميتاداتا (الحقوق) قبل الإرسال ──────────────
        // addStickerMetadata يُعيد البفر الأصلي لو فشل (لا يوقف السكربت)
        const finalBuf = await addStickerMetadata(stickerBuf, isAnimatedType);

        // إرسال كستكر واتساب
        await sock.sendMessage(chatId, {
            sticker: finalBuf,
        }, quotedMsg ? { quoted: quotedMsg } : {});
        return { ok: true, fallback: false };
    }

    if (usedFallback) {
        // Fallback: إرسال الملف الأصلي كصورة أو فيديو
        if (mimeType === 'webm' || mimeType === 'mp4') {
            await sock.sendMessage(chatId, {
                video:   rawBuf,
                mimetype: 'video/webm',
                caption: '_(متحرك — بدون ffmpeg)_',
            }, quotedMsg ? { quoted: quotedMsg } : {});
        } else {
            await sock.sendMessage(chatId, {
                image:  rawBuf,
                caption: '_(صورة fallback)_',
            }, quotedMsg ? { quoted: quotedMsg } : {});
        }
        return { ok: true, fallback: true };
    }

    return { ok: false, fallback: false };
}

// ══════════════════════════════════════════════════════════════
//  Telegram API
// ══════════════════════════════════════════════════════════════
async function verifyToken() {
    if (!TELEGRAM_TOKEN.trim()) return { ok: false, reason: 'empty' };
    try {
        const res = await axios.get(`${TG_API()}/getMe`, { timeout: 8_000 });
        if (res.data?.ok) return { ok: true, botUser: res.data.result.username };
        return { ok: false, reason: 'invalid' };
    } catch (e) {
        const s = e?.response?.status;
        return { ok: false, reason: s === 401 ? 'unauthorized' : s === 404 ? 'not_found' : 'network' };
    }
}

async function getStickerSet(name) {
    const res = await axios.get(`${TG_API()}/getStickerSet`, {
        params: { name }, timeout: 15_000,
    });
    if (!res.data.ok) throw new Error(res.data.description || 'حزمة غير موجودة');
    return res.data.result;
}

async function downloadTgFile(fileId) {
    const fRes = await axios.get(`${TG_API()}/getFile`, {
        params: { file_id: fileId }, timeout: 10_000,
    });
    if (!fRes.data.ok) throw new Error('getFile فشل: ' + fRes.data.description);
    const url = `${TG_FILE_API()}/${fRes.data.result.file_path}`;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 45_000 });
    return Buffer.from(res.data);
}

function extractPackName(input) {
    const m = input.match(/(?:t\.me\/addstickers\/)([A-Za-z0-9_]+)/i);
    if (m) return m[1];
    if (/^[A-Za-z0-9_]+$/.test(input.trim())) return input.trim();
    return null;
}

function tokenErrorMsg(reason) {
    const why = {
        empty:        'التوكن فارغ.',
        unauthorized: 'التوكن خاطئ أو محذوف.',
        not_found:    'التوكن غير صالح (404).',
        network:      'لا اتصال بخوادم تيليجرام.',
    };
    return (
`❌ *خطأ في إعداد البوت!*
⚠️ ${why[reason] || 'خطأ غير معروف'}

📋 *الحل:*
1️⃣ افتح @BotFather في تيليجرام
2️⃣ أرسل \`/newbot\` واحصل على التوكن
3️⃣ أضف في \`.env\`:
   \`TELEGRAM_BOT_TOKEN=توكنك_هنا\`
4️⃣ أعد تشغيل البوت`
    );
}

// ══════════════════════════════════════════════════════════════
//  إدارة الجلسات التفاعلية
//  المراحل: pack_info → ask_size → ask_group → sending
// ══════════════════════════════════════════════════════════════
const activeSessions  = new Map();   // chatId → session
const activeTimeouts  = new Map();   // chatId → timeout
const activeListeners = new Map();   // chatId → listener

const SESSION_TTL = 5 * 60_000; // 5 دقائق

function clearSession(chatId, sock) {
    if (activeTimeouts.has(chatId))  { clearTimeout(activeTimeouts.get(chatId)); activeTimeouts.delete(chatId); }
    if (activeListeners.has(chatId) && sock) { sock.ev.off('messages.upsert', activeListeners.get(chatId)); activeListeners.delete(chatId); }
    activeSessions.delete(chatId);
}

function resetTimeout(chatId, sock) {
    if (activeTimeouts.has(chatId)) clearTimeout(activeTimeouts.get(chatId));
    const h = setTimeout(() => {
        clearSession(chatId, sock);
        sock.sendMessage(chatId, { text: '⏰ _انتهت جلسة الستكرات تلقائياً._' }).catch(() => {});
    }, SESSION_TTL);
    activeTimeouts.set(chatId, h);
}

// ══════════════════════════════════════════════════════════════
//  بناء رسالة قائمة المجموعات
// ══════════════════════════════════════════════════════════════
function buildGroupsMenu(title, stickers, groupSize) {
    const total  = stickers.length;
    const groups = Math.ceil(total / groupSize);

    let text =
`🎭 *${title}*
📦 ${total} ستكر — مقسّمة لـ ${groups} مجموعة (${groupSize} لكل مجموعة)
━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let g = 1; g <= groups; g++) {
        const from = (g - 1) * groupSize + 1;
        const to   = Math.min(g * groupSize, total);
        text += `*${g}.* ستكر ${from} → ${to}   (${to - from + 1} ستكر)\n`;
    }

    text +=
`\n━━━━━━━━━━━━━━━━━━━━━━
*اكتب رقم المجموعة* اللي تبيها
*الكل* — لتحميل كل المجموعات
*الغاء* — للخروج`;

    return text;
}

// ══════════════════════════════════════════════════════════════
//  إرسال مجموعة ستكرات محددة
// ══════════════════════════════════════════════════════════════
async function sendGroup(sock, chatId, session, groupIndex, quotedMsg) {
    const { stickers, groupSize, title, statusMsgKey } = session;
    const from  = groupIndex * groupSize;
    const to    = Math.min(from + groupSize, stickers.length);
    const slice = stickers.slice(from, to);
    const label = `مجموعة ${groupIndex + 1} (${from + 1}→${to})`;

    const upd = txt => statusMsgKey &&
        sock.sendMessage(chatId, { text: txt, edit: statusMsgKey }).catch(() => {});

    await upd(`⏳ *جاري إرسال ${label}...*\n0/${slice.length}`);

    let sent = 0, failed = 0, fallbacks = 0;

    for (let i = 0; i < slice.length; i++) {
        try {
            const rawBuf = await downloadTgFile(slice[i].file_id);
            const mime   = detectMimeType(rawBuf);
            const result = await sendSticker(sock, chatId, rawBuf, mime, i === 0 ? quotedMsg : null);
            if (result.ok) { sent++; if (result.fallback) fallbacks++; }
            else failed++;
            await new Promise(r => setTimeout(r, SEND_DELAY));
        } catch (e) {
            console.error(`[ستكر/send]`, e?.message);
            failed++;
        }

        if ((i + 1) % 5 === 0 || i === slice.length - 1) {
            await upd(`⏳ *${label}*\n📤 ${sent}/${slice.length}${failed ? `  ❌ ${failed}` : ''}`);
        }
    }

    await upd(
`✅ *${label} — تم!*
✔️ أُرسل: ${sent}${fallbacks ? ` (${fallbacks} fallback)` : ''}
${failed ? `❌ فشل: ${failed}` : ''}

💡 اكتب رقم مجموعة أخرى أو *الغاء*`
    );

    await sock.sendMessage(chatId, { react: { text: '✔️', key: quotedMsg?.key || {} } }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  execute
// ══════════════════════════════════════════════════════════════
async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;

    // لو في جلسة نشطة — المستخدم يكمل داخلها
    if (activeSessions.has(chatId)) {
        await sock.sendMessage(chatId, {
            text: '⏳ _لديك جلسة نشطة، أكمل من حيث توقفت أو اكتب *الغاء*._',
        }, { quoted: msg });
        return;
    }

    // ① تحقق من التوكن
    const tk = await verifyToken();
    if (!tk.ok) {
        await sock.sendMessage(chatId, { text: tokenErrorMsg(tk.reason) }, { quoted: msg });
        return;
    }

    const input = args.join(' ').trim();

    if (!input) {
        const ffOk = await hasFfmpeg();
        await sock.sendMessage(chatId, {
            text:
`🎭 *محوّل ستكرات تيليجرام → واتساب*
🤖 @${tk.botUser} ✅  •  ffmpeg: ${ffOk ? '✅' : '❌'}

أرسل رابط الحزمة أو اسمها:
• \`https://t.me/addstickers/PackName\`
• \`PackName\``,
        }, { quoted: msg });
        return;
    }

    const packName = extractPackName(input);
    if (!packName) {
        await sock.sendMessage(chatId, {
            text: '❌ *صيغة غير صحيحة!*\nمثال: `https://t.me/addstickers/PackName`',
        }, { quoted: msg });
        return;
    }

    await sock.sendMessage(chatId, { react: { text: '🕒', key: msg.key } }).catch(() => {});

    const statusMsg = await sock.sendMessage(chatId, {
        text: `🔍 جاري جلب \`${packName}\`...`,
    }, { quoted: msg }).catch(() => null);

    const upd = txt => statusMsg &&
        sock.sendMessage(chatId, { text: txt, edit: statusMsg.key }).catch(() => {});

    // ② جلب الحزمة
    let stickerSet;
    try {
        stickerSet = await getStickerSet(packName);
    } catch (e) {
        await upd(
            e.message?.includes('STICKERSET_INVALID') || e.message?.includes('غير موجودة')
                ? `❌ الحزمة \`${packName}\` غير موجودة!\nhttps://t.me/addstickers/${packName}`
                : `❌ خطأ: ${e.message?.slice(0, 100)}`
        );
        await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
        return;
    }

    const stickers  = stickerSet.stickers || [];
    const title     = stickerSet.title || packName;
    const total     = stickers.length;

    if (!total) {
        await upd('❌ الحزمة فارغة!');
        return;
    }

    // ③ اعرض معلومات الحزمة واسأل عن حجم المجموعة
    await upd(
`✅ *وُجدت الحزمة!*

🎭 *${title}*
📦 إجمالي الستكرات: *${total}*

━━━━━━━━━━━━━━━━━━━━━━
*كم ستكر تبي في كل مجموعة؟*

_أمثلة:_
• \`10\` — مجموعات من 10
• \`20\` — مجموعات من 20
• \`${total}\` — كل الستكرات دفعة واحدة

اكتب *الغاء* للخروج`
    );

    // ── حفظ الجلسة في مرحلة "انتظار حجم المجموعة" ──
    const session = {
        phase:        'ask_size',
        packName,
        title,
        stickers,
        total,
        groupSize:    null,
        statusMsgKey: statusMsg?.key || null,
        msgKey:       msg.key,
    };
    activeSessions.set(chatId, session);
    resetTimeout(chatId, sock);

    // ── Listener الرئيسي للجلسة ──────────────────────────
    const listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        // حذفنا m.key.fromMe لكي يستجيب البوت لرسائلك الشخصية أيضاً
         if (!m?.message || m.key.remoteJid !== chatId) return;

        const text = (
            m.message.conversation ||
            m.message.extendedTextMessage?.text || ''
        ).trim();
        if (!text) return;

        const sess = activeSessions.get(chatId);
        if (!sess) return;

        resetTimeout(chatId, sock);

        const lower = text.toLowerCase();

        // إلغاء في أي مرحلة
        if (lower === 'الغاء' || lower === 'إلغاء' || lower === 'cancel') {
            clearSession(chatId, sock);
            await sock.sendMessage(chatId, { text: '✅ _تم إلغاء الجلسة._' });
            return;
        }

        try {
            // ─── مرحلة 1: انتظر حجم المجموعة ───────────────────
            if (sess.phase === 'ask_size') {
                const size = parseInt(text);
                

                sess.groupSize = size;
                sess.phase     = 'ask_group';

                // اعرض قائمة المجموعات
                const menuText = buildGroupsMenu(sess.title, sess.stickers, size);
                const sessUpd  = txt => sess.statusMsgKey &&
                    sock.sendMessage(chatId, { text: txt, edit: sess.statusMsgKey }).catch(() => {});
                await sessUpd(menuText);
                return;
            }

            // ─── مرحلة 2: انتظر رقم المجموعة ───────────────────
            if (sess.phase === 'ask_group') {
                const groups = Math.ceil(sess.total / sess.groupSize);

                // "الكل" — تحميل كل المجموعات
                if (lower === 'الكل' || lower === 'كل' || lower === 'all') {
                    sess.phase = 'sending';
                    await sock.sendMessage(chatId, { react: { text: '⏳', key: m.key } }).catch(() => {});

                    for (let g = 0; g < groups; g++) {
                        await sendGroup(sock, chatId, sess, g, m);
                        if (g < groups - 1) await new Promise(r => setTimeout(r, 1000));
                    }

                    clearSession(chatId, sock);
                    return;
                }

                const groupNum = parseInt(text);

                if (isNaN(groupNum) || groupNum < 1 || groupNum > groups) {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ _اكتب رقماً بين 1 و ${groups}، أو اكتب *الكل* لتحميل الكل_`,
                    });
                    return;
                }

                sess.phase = 'sending';
                await sock.sendMessage(chatId, { react: { text: '⏳', key: m.key } }).catch(() => {});
                await sendGroup(sock, chatId, sess, groupNum - 1, m);

                // إعادة لمرحلة اختيار المجموعة (لا تغلق الجلسة)
                sess.phase = 'ask_group';

                // عرض القائمة مجدداً
                const menuText = buildGroupsMenu(sess.title, sess.stickers, sess.groupSize);
                const sessUpd  = txt => sess.statusMsgKey &&
                    sock.sendMessage(chatId, { text: txt, edit: sess.statusMsgKey }).catch(() => {});
                await sessUpd(menuText);
                return;
            }

        } catch (listenerErr) {
            console.error('[ستكر/listener]', listenerErr?.message);
            await sock.sendMessage(chatId, {
                text: `❌ خطأ: ${listenerErr?.message?.slice(0, 80)}`,
            }).catch(() => {});
            clearSession(chatId, sock);
        }
    };

    activeListeners.set(chatId, listener);
    sock.ev.on('messages.upsert', listener);

    await sock.sendMessage(chatId, { react: { text: '✔️', key: msg.key } }).catch(() => {});
}

export default { NovaUltra, execute };
