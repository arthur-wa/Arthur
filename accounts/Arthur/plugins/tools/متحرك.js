// ══════════════════════════════════════════════════════════════
//  متحرك.js — تحويل الملصقات إلى صور وفيديوهات بأعلى جودة ممكنة (Ultra HD)
// ══════════════════════════════════════════════════════════════

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';
import FormData from 'form-data';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '../../tmp');
fs.ensureDirSync(TMP);

const STELLAR_URL = "https://api.stellarwa.xyz";
const STELLAR_KEY = "YukiWaBot";

const NovaUltra = {
    command: ['متحرك', 'تحويل', 'توميديا', 'لجودة'],
    description: 'يحول الملصق إلى صورة HD أو فيديو عالي الدقة والوضوح عبر الـ AI',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off'
};

async function uploadToUguu(buffer) {
    try {
        const body = new FormData();
        body.append("files[]", buffer, "image.png");
        const res = await axios.post("https://uguu.se/upload.php", body, {
            headers: body.getHeaders(),
            timeout: 15000
        });
        return res.data?.files?.[0]?.url || null;
    } catch {
        return null;
    }
}

async function getEnhancedBuffer(url) {
    try {
        const res = await axios.get(`${STELLAR_URL}/tools/upscale?url=${url}&key=${STELLAR_KEY}`, {
            responseType: "arraybuffer",
            timeout: 25000
        });
        if (res.status !== 200) return null;
        return Buffer.from(res.data);
    } catch {
        return null;
    }
}

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted || !quoted.stickerMessage) {
        return sock.sendMessage(chatId, { text: '↩️ الرجاء الرد على *ملصق (ستيكر)* لتحويله بأعلى جودة.' }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

    try {
        const targetMsg = {
            key: {
                remoteJid: chatId,
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                participant: msg.message.extendedTextMessage.contextInfo.participant
            },
            message: quoted
        };

        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, {
            logger: sock.logger,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!buffer) throw new Error('فشل تحميل الملصق');

        const isAnimated = quoted.stickerMessage.isAnimated;
        const id = crypto.randomBytes(6).toString('hex');

        if (isAnimated) {
            let tmpIn = path.join(TMP, `stk_in_${id}.webp`);
            const tmpOut = path.join(TMP, `stk_out_${id}.mp4`);

            // تحويل الـ WebP المتحرك إلى GIF بواسطة sharp أولاً لتفادي مشاكل مفكك ترميز ffmpeg الخاص بالـ webp
            let usedSharpGif = false;
            try {
                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();
                tmpIn = path.join(TMP, `stk_in_${id}.gif`);
                await fs.writeFile(tmpIn, gifBuffer);
                usedSharpGif = true;
            } catch {
                await fs.writeFile(tmpIn, buffer);
            }

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(tmpIn)
                        .outputOptions([
                            '-vcodec', 'libx264',
                            '-crf', '12',                    // جودة إنتاج فائقة (تمنع تشوه الألوان والبكسلات)
                            '-preset', 'veryslow',
                            '-pix_fmt', 'yuv420p',
                            '-vf', 'scale=1080:1080:flags=lanczos' // فلتر ريفلكس التكبير عالي النقاء للأبعاد
                        ])
                        .toFormat('mp4')
                        .save(tmpOut)
                        .on('end', resolve)
                        .on('error', reject);
                });
            } catch (ffmpegErr) {
                // ملاذ أخير: إذا فشل كـ GIF، نحاول معالجة الـ WebP مباشرةً مع تجاهل الإطارات التالفة
                if (usedSharpGif) {
                    tmpIn = path.join(TMP, `stk_in_${id}.webp`);
                    await fs.writeFile(tmpIn, buffer);
                    await new Promise((resolve, reject) => {
                        ffmpeg(tmpIn)
                            .inputOptions(['-err_detect ignore_err', '-fflags +discardcorrupt'])
                            .outputOptions(['-vcodec', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-vf', 'scale=1080:1080'])
                            .toFormat('mp4').save(tmpOut).on('end', resolve).on('error', reject);
                    });
                } else {
                    throw ffmpegErr;
                }
            }

            const videoBuffer = await fs.readFile(tmpOut);
            await sock.sendMessage(chatId, { video: videoBuffer, caption: '🎬 *تم تحويل الملصق المتحرك إلى فيديو بدقة فائقة Ultra HD (1080x1080).*' }, { quoted: msg });
            
            await fs.remove(path.join(TMP, `stk_in_${id}.webp`)).catch(() => {});
            await fs.remove(path.join(TMP, `stk_in_${id}.gif`)).catch(() => {});
            await fs.remove(tmpOut).catch(() => {});
        } else {
            // تكبير محلي نقي جداً أولاً لتجنب فقدان الحواف
            let finalImageBuffer = await sharp(buffer)
                .resize(2048, 2048, { kernel: sharp.kernel.lanczos3, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();

            // معالجة إضافية وترقية ملامح بذكاء الـ AI من خوادم ريميني المدمجة
            const uploadedUrl = await uploadToUguu(finalImageBuffer);
            if (uploadedUrl) {
                const aiEnhanced = await getEnhancedBuffer(uploadedUrl);
                if (aiEnhanced) {
                    finalImageBuffer = aiEnhanced;
                }
            }

            await sock.sendMessage(chatId, { image: finalImageBuffer, caption: '📸 *تم تحويل الملصق وتكبيره لـ صورة عالية الدقة بـ استخدام الذكاء الاصطناعي (HD/AI).*' }, { quoted: msg });
        }

        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});
    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: `❌ حدث خطأ أثناء التحويل عالي الجودة: ${err.message}` }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
    }
}

export default { NovaUltra, execute };