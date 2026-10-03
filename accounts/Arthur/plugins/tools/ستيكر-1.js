// ══════════════════════════════════════════════════════════════
//  ستيكر.js — جلسة ملصقات تفاعلية
//  • يقبل أي صورة / فيديو / GIF بعد فتح الجلسة
//  • EXIF: Ayano | Arvania
//  • ضغط تدريجي + قص مربع عبر ffmpeg
//  • تنظيف tmp بعد كل عملية
// ══════════════════════════════════════════════════════════════

import path      from 'path';
import fs        from 'fs-extra';
import crypto    from 'crypto';
import { fileURLToPath }        from 'url';
import { fileTypeFromBuffer }   from 'file-type';
import ffmpeg                   from 'fluent-ffmpeg';
import ffmpegInstaller          from '@ffmpeg-installer/ffmpeg';
import webp                     from 'node-webpmux';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP       = path.join(__dirname, '../../tmp');
fs.ensureDirSync(TMP);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  EXIF  —  Ayano | Arvania
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function addExif(buffer) {
    const img     = new webp.Image();
    const id      = crypto.randomBytes(32).toString('hex');
    const json    = {
        'sticker-pack-id':        id,
        'sticker-pack-name':      ' 𝙰𝚛𝚝𝚑𝚞𝚛',
        'sticker-pack-publisher': '© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛',
        emojis: ['✨'],
    };
    const exifAttr = Buffer.from([
        0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,
        0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
        0x00,0x00,0x16,0x00,0x00,0x00,
    ]);
    const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const exif    = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);
    await img.load(buffer);
    img.exif = exif;
    return await img.save(null);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ffmpeg helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CROP_FILTER = (size) =>
    `crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=${size}:${size}`;

function toStaticWebp(inputPath, outputPath) {
    return new Promise((resolve, reject) =>
        ffmpeg(inputPath)
            .outputOptions([
                '-vcodec', 'libwebp',
                '-vf', CROP_FILTER(512),
                '-loop', '1',
                '-preset', 'default',
                '-compression_level', '6',
                '-quality', '80',
                '-an', '-vsync', '0', '-t', '1',
            ])
            .toFormat('webp').save(outputPath)
            .on('end', resolve).on('error', reject)
    );
}

function toAnimatedWebp(inputPath, outputPath, quality, fps, size) {
    const vf = `${CROP_FILTER(size)},fps=${fps}`;
    const tryEncode = (codec) =>
        new Promise((resolve, reject) =>
            ffmpeg(inputPath)
                .outputOptions([
                    '-vcodec', codec,
                    '-vf', vf,
                    '-loop', '0',
                    '-preset', 'default',
                    '-compression_level', '10',
                    '-quality', String(quality),
                    '-an', '-vsync', '0', '-t', '10',
                ])
                .toFormat('webp').save(outputPath)
                .on('end', resolve).on('error', reject)
        );

    return tryEncode('libwebp_anim').catch(() => tryEncode('libwebp'));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  makeSticker — التحويل الكامل + تنظيف tmp
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MAX_SIZE = 900 * 1024; // 900 KB

async function makeSticker(buffer) {
    const type = await fileTypeFromBuffer(buffer);
    if (!type) throw new Error('نوع الملف غير معروف');

    const isAnimated =
        /video|gif/i.test(type.mime) ||
        ['mp4','webm','gif','mov'].includes(type.ext);

    const id     = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const tmpIn  = path.join(TMP, `stk_in_${id}.${type.ext}`);
    const tmpOut = path.join(TMP, `stk_out_${id}.webp`);

    await fs.writeFile(tmpIn, buffer);

    try {
        if (!isAnimated) {
            await toStaticWebp(tmpIn, tmpOut);
            return await addExif(await fs.readFile(tmpOut));
        }

        // ── ضغط تدريجي للملصقات المتحركة ────────────────────
        const attempts = [
            { quality: 75, fps: 10, size: 512 },
            { quality: 60, fps:  8, size: 384 },
            { quality: 45, fps:  6, size: 256 },
            { quality: 30, fps:  5, size: 256 },
        ];

        let finalBuf = null;
        for (const { quality, fps, size } of attempts) {
            if (fs.existsSync(tmpOut)) await fs.remove(tmpOut);
            await toAnimatedWebp(tmpIn, tmpOut, quality, fps, size);
            if (!fs.existsSync(tmpOut)) continue;
            const buf = await fs.readFile(tmpOut);
            if (buf.length <= MAX_SIZE) { finalBuf = buf; break; }
        }

        if (!finalBuf && fs.existsSync(tmpOut))
            finalBuf = await fs.readFile(tmpOut);

        if (!finalBuf) throw new Error('فشل التحويل');
        return await addExif(finalBuf);

    } finally {
        // ── تنظيف tmp بعد كل عملية ──────────────────────────
        await fs.remove(tmpIn).catch(() => {});
        await fs.remove(tmpOut).catch(() => {});
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NovaUltra
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const NovaUltra = {
    command:     'ستيك',
    description: 'جلسة ملصقات — يحول أي صورة/فيديو/GIF ترسله لملصق',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  جلسات نشطة
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const activeSessions = new Map();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  استخراج buffer من رسالة (مباشرة أو مقتبسة)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function extractMediaMsg(m) {
    const content = m.message || {};

    // رسالة مقتبسة
    const ctx = content.extendedTextMessage?.contextInfo;
    if (ctx?.quotedMessage) {
        const q = ctx.quotedMessage;
        if (q.imageMessage || q.videoMessage || q.stickerMessage || q.documentMessage) {
            return {
                message: q,
                key: { ...m.key, id: ctx.stanzaId, participant: ctx.participant },
            };
        }
    }

    // رسالة مباشرة
    if (content.imageMessage || content.videoMessage ||
        content.stickerMessage || content.documentMessage) {
        return m;
    }

    return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  execute
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function execute({ sock, msg }) {
    const chatId    = msg.key.remoteJid;
    const senderJid = msg.key.participant || chatId;

    const send = (text) =>
        sock.sendMessage(chatId, { text }, { quoted: msg }).catch(() => {});

    // ── إذا في جلسة نشطة ────────────────────────────────────
    if (activeSessions.has(chatId)) {
        await sock.sendMessage(chatId, {
            text: '⚠️ _جلسة ملصقات مفتوحة بالفعل_\n_أرسل صورة/فيديو أو اكتب *انهاء*_',
        }, { quoted: msg }).catch(() => {});
        return;
    }

    // ── رسالة البداية ────────────────────────────────────────
    await sock.sendMessage(chatId, {
        text:
`~*◉━━━━── •⧉ ✨ ⧉• ──━━━━◉*~

\`⌬━╌⤣ جـلـسـة مـلـصـقـات ❄️ ⤤╌━⌬\`

*ابدأ إرسال الصور أو الفيديوهات*
_كل ما ترسله يتحول لملصق فوراً_ ✨

_اكتب *انهاء* أو *الغاء* لإغلاق الجلسة_
_⏰ تنتهي تلقائياً بعد 10 دقائق_

~*◉━━━━── •⧉ ✨ ⧉• ──━━━━◉*~`,
    }, { quoted: msg }).catch(() => {});

    // ── إنشاء الجلسة ─────────────────────────────────────────
    const sessionData = { senderJid, queue: Promise.resolve() };
    activeSessions.set(chatId, sessionData);

    // ── إذا أرسل الأمر مع ميديا مباشرة — حوّلها الآن ────────
    const directMedia = extractMediaMsg(msg);
    if (directMedia) {
        sessionData.queue = sessionData.queue.then(() => processMedia(sock, chatId, directMedia, msg.key)).catch(() => {});
    }

    const cleanup = () => {
        clearTimeout(timeout);
        activeSessions.delete(chatId);
        sock.ev.off('messages.upsert', listener);
    };

    // ── timeout 10 دقائق ─────────────────────────────────────
    const timeout = setTimeout(() => {
        if (activeSessions.has(chatId)) {
            cleanup();
            sock.sendMessage(chatId, {
                text:
`~*◉━━━━── •⧉ ✨ ⧉• ──━━━━◉*~

\`⌬━╌⤣ انتهت الجلسة ⏰ ⤤╌━⌬\`

_انتهت مدة الجلسة (10 دقائق)_
_أعد كتابة *ستيكر.* لبدء جلسة جديدة_

~*◉━━━━── •⧉ ✨ ⧉• ──━━━━◉*~`,
            }).catch(() => {});
        }
    }, 10 * 60 * 1000);

    // ── الـ listener ─────────────────────────────────────────
    const listener = async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;

        // تأكد أن نفس الشخص اللي فتح الجلسة
        const incomingSender = m.key.participant || m.key.remoteJid;
        if (incomingSender !== senderJid) return;

        const text = (
            m.message.conversation ||
            m.message.extendedTextMessage?.text || ''
        ).trim();

        // ── إنهاء الجلسة ─────────────────────────────────────
        if (['انهاء', 'الغاء', 'إنهاء', 'إلغاء', 'stop'].includes(text)) {
            cleanup();
            await sock.sendMessage(chatId, {
                text:
`~*◉━━━━── •⧉ ✨ ⧉• ──━━━━◉*~

\`⌬━╌⤣ تـم إغـلاق الجـلسة ✅ ⤤╌━⌬\`

_شكراً على استخدامك جلسة الملصقات_ ✨

~*◉━━━━── •⧉ ✨ ⧉• ──━━━━◉*~`,
            }).catch(() => {});
            return;
        }

        // ── تحقق من وجود ميديا ──────────────────────────────
        const mediaMsg = extractMediaMsg(m);
        if (!mediaMsg) return; // رسالة نصية عادية → تجاهل

        const session = activeSessions.get(chatId);
        if (session) {
            session.queue = session.queue.then(() => processMedia(sock, chatId, mediaMsg, m.key)).catch(() => {});
        }
    };

    sock.ev.on('messages.upsert', listener);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  processMedia — تحميل + تحويل + إرسال
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function processMedia(sock, chatId, mediaMsg, reactKey) {
    // react ⏳
    if (reactKey) {
        await sock.sendMessage(chatId, {
            react: { text: '⏳', key: reactKey },
        }).catch(() => {});
    }

    try {
        const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}, {
            logger: sock.logger,
            reuploadRequest: sock.updateMediaMessage,
        });
        if (!buffer?.length) throw new Error('فشل تحميل الملف');

        const sticker = await makeSticker(buffer);

        await sock.sendMessage(chatId, { sticker });

        // react ✅
        if (reactKey) {
            await sock.sendMessage(chatId, {
                react: { text: '✅', key: reactKey },
            }).catch(() => {});
        }

    } catch (err) {
        console.error('[STICKER SESSION ERROR]', err?.message);
        if (reactKey) {
            await sock.sendMessage(chatId, {
                react: { text: '❌', key: reactKey },
            }).catch(() => {});
        }
    }
}

export default { NovaUltra, execute };
