// ══════════════════════════════════════════════════════════════
//  ملصق.js — تحويل الصور والفيديوهات (أول 5 ثوانٍ) إلى ملصقات
// ══════════════════════════════════════════════════════════════

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '../../tmp');
fs.ensureDirSync(TMP);

const NovaUltra = {
    command: ['ملصق', 'ستيكر2', 'ملصقي'],
    description: 'يحول الصورة أو أول 5 ثوانٍ من الفيديو إلى ملصق فوري بميتاداتا الحقوق',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off'
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted 
        ? { message: quoted, key: { ...msg.key, id: msg.message.extendedTextMessage.contextInfo.stanzaId, participant: msg.message.extendedTextMessage.contextInfo.participant } }
        : msg;

    const mtype = Object.keys(targetMsg.message || {}).find(k => k === 'imageMessage' || k === 'videoMessage');

    if (!mtype) {
        return sock.sendMessage(chatId, { text: '↩️ الرجاء الرد على *صورة* أو *فيديو* لتحويله إلى ملصق.' }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

    try {
        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, {
            logger: sock.logger,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!buffer) throw new Error('فشل تحميل الميديا');

        let finalBuffer = buffer;
        const id = crypto.randomBytes(6).toString('hex');

        if (mtype === 'videoMessage') {
            const tmpIn = path.join(TMP, `vid_in_${id}.mp4`);
            const tmpOut = path.join(TMP, `vid_out_${id}.webp`);
            await fs.writeFile(tmpIn, buffer);

            // معالجة الفيديو وقص أول 5 ثوانٍ فقط وتعديل الأبعاد والمعدل
            await new Promise((resolve, reject) => {
                ffmpeg(tmpIn)
                    .outputOptions([
                        '-vcodec', 'libwebp',
                        '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
                        '-loop', '0',
                        '-t', '5', 
                        '-preset', 'default',
                        '-an',
                        '-vsync', '0'
                    ])
                    .toFormat('webp')
                    .save(tmpOut)
                    .on('end', resolve)
                    .on('error', reject);
            });

            finalBuffer = await fs.readFile(tmpOut);
            await fs.remove(tmpIn).catch(() => {});
            await fs.remove(tmpOut).catch(() => {});
        }

        const sticker = new Sticker(finalBuffer, {
            pack: ' 𝙰𝚛𝚝𝚑𝚞𝚛',
            author: '© mᥲძᥱ ᥕі𝗍һ ᑲᥡ 𝙰𝚛𝚝һ𝚞𝚛',
            type: StickerTypes.FULL,
            quality: 70
        });

        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});

    } catch (err) {
        console.error(err);
        await sock.sendMessage(chatId, { text: `❌ فشل تحويل الميديا إلى ملصق: ${err.message}` }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
    }
}

export default { NovaUltra, execute };