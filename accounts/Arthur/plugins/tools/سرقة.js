// ══════════════════════════════════════════════════════════════
//  سرقة.js — يسرق ستكر ويغيّر بياناته (الكاتب / اسم الحزمة)
//  يستخدم wa-sticker-formatter بدل EXIF يدوي
// ══════════════════════════════════════════════════════════════

import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import sharp         from 'sharp';
import { exec }      from 'child_process';
import { promisify } from 'util';
import fs   from 'fs/promises';
import path from 'path';
import os   from 'os';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';

const execAsync = promisify(exec);

export const NovaUltra = {
    command:     ['سرقة', 'سرق', 'steal'],
    description: 'يسرق ستكر ويغيّر بياناته لحقوقك',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

// ══════════════════════════════════════════════════════════════
//  ⚙️ إعداداتك
// ══════════════════════════════════════════════════════════════
const PACK_NAME   = '𝙰𝚛𝚝𝚑𝚞𝚛 ©';
const PACK_AUTHOR = '© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛';

// ══════════════════════════════════════════════════════════════
//  كشف نوع الملف
// ══════════════════════════════════════════════════════════════
function isAnimatedWebp(buf) {
    return buf.indexOf(Buffer.from('ANIM')) !== -1;
}

function isWebp(buf) {
    return buf.length >= 12 &&
        buf.slice(0, 4).toString() === 'RIFF' &&
        buf.slice(8, 12).toString() === 'WEBP';
}

function isWebm(buf) {
    return buf.length >= 4 &&
        buf[0] === 0x1a && buf[1] === 0x45 &&
        buf[2] === 0xdf && buf[3] === 0xa3;
}

function isTgs(buf) {
    return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// ══════════════════════════════════════════════════════════════
//  إضافة metadata عبر wa-sticker-formatter
// ══════════════════════════════════════════════════════════════
async function addMetadata(buf, animated = false) {
    try {
        const sticker = new Sticker(buf, {
            pack:    PACK_NAME,
            author:  PACK_AUTHOR,
            type:    StickerTypes.FULL,
            quality: 60,
        });
        return await sticker.toBuffer();
    } catch (err) {
        console.warn('[سرقة/metadata]', err?.message?.slice(0, 80));
        return buf; // أعد الأصلي لو فشل
    }
}

// ══════════════════════════════════════════════════════════════
//  تحويل WebM → WebP
// ══════════════════════════════════════════════════════════════
async function webmToWebp(buf) {
    const tmp  = await fs.mkdtemp(path.join(os.tmpdir(), 'steal-'));
    const inp  = path.join(tmp, 'in.webm');
    const out  = path.join(tmp, 'out.webp');
    try {
        await fs.writeFile(inp, buf);
        await execAsync(
            `ffmpeg -i "${inp}" ` +
            `-vf "scale=512:512:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=30" ` +
            `-vcodec libwebp -lossless 0 -q:v 80 -loop 0 -an -vsync 0 "${out}" -y 2>/dev/null`
        );
        return await fs.readFile(out);
    } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

// ══════════════════════════════════════════════════════════════
//  تحويل TGS → WebP
// ══════════════════════════════════════════════════════════════
async function tgsToWebp(buf) {
    const tmp  = await fs.mkdtemp(path.join(os.tmpdir(), 'stealthgs-'));
    const tgs  = path.join(tmp, 'in.tgs');
    const gif  = path.join(tmp, 'out.gif');
    const out  = path.join(tmp, 'out.webp');
    try {
        await fs.writeFile(tgs, buf);
        try { await execAsync(`lottie_convert.py "${tgs}" "${gif}" 2>/dev/null`); }
        catch { await execAsync(`zcat "${tgs}" > "${gif}" 2>/dev/null || true`); }
        await execAsync(
            `ffmpeg -i "${gif}" ` +
            `-vf "scale=512:512:force_original_aspect_ratio=decrease,` +
            `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=20" ` +
            `-vcodec libwebp -lossless 0 -q:v 80 -loop 0 -an -vsync 0 "${out}" -y 2>/dev/null`
        );
        return await fs.readFile(out);
    } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

// ══════════════════════════════════════════════════════════════
//  تحميل الستكر
// ══════════════════════════════════════════════════════════════
async function downloadSticker(stickerMsg) {
    const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// ══════════════════════════════════════════════════════════════
//  execute
// ══════════════════════════════════════════════════════════════
async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    const quoted     = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const stickerMsg = quoted?.stickerMessage || msg.message?.stickerMessage;

    if (!stickerMsg) {
        await sock.sendMessage(chatId, {
            text: '↩️ *رد على ستكر* باستخدام الأمر',
        }, { quoted: msg });
        return;
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

    try {
        // ① تحميل الستكر
        let webpBuf = await downloadSticker(stickerMsg);
        let animated = false;

        // ② تحويل حسب النوع
        if (isWebm(webpBuf)) {
            const ffOk = await execAsync('ffmpeg -version 2>/dev/null').then(() => true).catch(() => false);
            if (!ffOk) {
                await sock.sendMessage(chatId, {
                    text: '❌ الستكر المتحرك يحتاج ffmpeg:\n`apt install ffmpeg -y`',
                }, { quoted: msg });
                await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
                return;
            }
            webpBuf  = await webmToWebp(webpBuf);
            animated = true;

        } else if (isTgs(webpBuf)) {
            webpBuf  = await tgsToWebp(webpBuf);
            animated = true;

        } else if (!isWebp(webpBuf)) {
            // نوع مجهول → تحويل عبر sharp
            webpBuf = await sharp(webpBuf)
                .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .webp({ quality: 90 })
                .toBuffer();
        } else {
            animated = isAnimatedWebp(webpBuf);
        }

        // ③ إضافة metadata عبر wa-sticker-formatter
        const finalBuf = await addMetadata(webpBuf, animated);

        // ④ إرسال
        await sock.sendMessage(chatId, {
            sticker: finalBuf,
        }, { quoted: msg });

        await sock.sendMessage(chatId, { react: { text: '✔️', key: msg.key } }).catch(() => {});

    } catch (err) {
        console.error('[سرقة]', err?.message);

        const errText = err?.message?.includes('ffmpeg')
            ? '❌ يحتاج ffmpeg: `apt install ffmpeg -y`'
            : err?.message?.includes('decrypt') || err?.message?.includes('download')
            ? '❌ فشل تحميل الستكر — جرب مرة ثانية.'
            : `❌ خطأ: ${err?.message?.slice(0, 80)}`;

        await sock.sendMessage(chatId, { text: errText }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
    }
}

export default { NovaUltra, execute };
