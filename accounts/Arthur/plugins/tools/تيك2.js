// ══════════════════════════════════════════════════════════════
//  تيك2.js — تحميل مباشر وسريع من TikTok (بدون تحويل ffmpeg)
//  ✅ رابط فقط → تحميل فوري
//  ✅ لا بحث، لا جلسات، لا صفحات
//  ✅ يحاول HD أولاً كـ URL مباشر، ثم SD، ثم buffer خام بدون transcode
// ══════════════════════════════════════════════════════════════

import axios from 'axios';

const NovaUltra = {
    command:     ['تيك', 'تيكطول', 'تيكفوري'],
    description: 'يحمّل فيديو TikTok من رابط مباشرة بدون تحويل',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

const TIKWM_BASE = 'https://www.tikwm.com';
const TIKWM_UA   =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';

const TIKWM_HEADERS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Cookie':       'current_language=en',
    'User-Agent':   TIKWM_UA,
    'Referer':      'https://www.tikwm.com/',
};

// ══════════════════════════════════════════════════════════════
//  tikwm — تحميل بيانات الفيديو من رابط
// ══════════════════════════════════════════════════════════════
async function downloadByUrl(tiktokUrl) {
    const params = new URLSearchParams({ url: tiktokUrl, hd: '1' });

    const res = await axios.post(
        `${TIKWM_BASE}/api/`,
        params.toString(),
        { headers: TIKWM_HEADERS, timeout: 20_000 }
    );

    const d = res.data?.data;
    if (!d) return null;

    return {
        title:    (d.title || d.desc || '').slice(0, 120),
        handle:   d.author?.unique_id || d.author?.nickname || 'مجهول',
        hdUrl:    d.hdplay || null,
        videoUrl: d.play   || null,
        images:   d.images || null,
        audioUrl: d.music  || null,
        type:     d.type   || 'video',
    };
}

async function fetchBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout:      90_000,
        headers: {
            'User-Agent': TIKWM_UA,
            'Referer':    'https://www.tiktok.com/',
        },
        maxRedirects: 10,
    });
    return Buffer.from(res.data);
}

function buildCaption(v) {
    return `🎵 *${v.title || 'بدون عنوان'}*\n👤 @${v.handle}\n\n> *TikTok — تحميل فوري*`;
}

// ══════════════════════════════════════════════════════════════
//  إرسال بدون أي تحويل: URL مباشر أولاً، ثم buffer خام
// ══════════════════════════════════════════════════════════════
async function sendRaw(sock, chatId, video, quotedMsg) {
    const caption = buildCaption(video);

    // slideshow
    if (video.type === 'image' && Array.isArray(video.images) && video.images.length) {
        for (let i = 0; i < video.images.length; i++) {
            await sock.sendMessage(chatId, {
                image:   { url: video.images[i] },
                caption: i === 0 ? caption : `📸 ${i + 1}/${video.images.length}`,
            }, i === 0 && quotedMsg ? { quoted: quotedMsg } : {}).catch(() => {});
        }
        if (video.audioUrl) {
            await sock.sendMessage(chatId, { audio: { url: video.audioUrl }, mimetype: 'audio/mp4' }).catch(() => {});
        }
        return true;
    }

    const url = video.hdUrl || video.videoUrl;
    if (!url) return false;

    // محاولة 1: إرسال الرابط مباشرة (أسرع طريقة، بدون أي معالجة)
    try {
        await sock.sendMessage(chatId, {
            video:    { url },
            mimetype: 'video/mp4',
            caption,
        }, quotedMsg ? { quoted: quotedMsg } : {});
        return true;
    } catch (e) {
        console.error('[تيك2/url]', e?.message);
    }

    // محاولة 2: تحميل buffer خام وإرساله كما هو، بدون transcode
    try {
        const buf = await fetchBuffer(url);
        await sock.sendMessage(chatId, {
            video:    buf,
            mimetype: 'video/mp4',
            caption,
        }, quotedMsg ? { quoted: quotedMsg } : {});
        return true;
    } catch (e) {
        console.error('[تيك2/buffer]', e?.message);
    }

    return false;
}

// ══════════════════════════════════════════════════════════════
//  execute
// ══════════════════════════════════════════════════════════════
async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const input  = args.join(' ').trim();

    if (!/https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok|vt\.tiktok)/i.test(input)) {
        await sock.sendMessage(chatId, {
            text: '🎵 *تحميل تيكتوك فوري*\n\nأرسل رابط الفيديو مباشرة بعد الأمر:\n`.تيك2 https://vt.tiktok.com/...`',
        }, { quoted: msg });
        return;
    }

    await sock.sendMessage(chatId, { react: { text: '🕒', key: msg.key } }).catch(() => {});

    const statusMsg = await sock.sendMessage(chatId, {
        text: '⏳ *جاري التحميل...*',
    }, { quoted: msg }).catch(() => null);

    const upd = txt => statusMsg &&
        sock.sendMessage(chatId, { text: txt, edit: statusMsg.key }).catch(() => {});

    try {
        const video = await downloadByUrl(input);

        if (!video?.videoUrl && !video?.hdUrl && !video?.images) {
            await upd('❌ *فشل جلب الفيديو.* تأكد من الرابط.');
            await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
            return;
        }

        const ok = await sendRaw(sock, chatId, video, msg);

        if (ok) {
            await sock.sendMessage(chatId, { react: { text: '✔️', key: msg.key } }).catch(() => {});
            await upd(`☑️ *تم!*\n🎵 ${video.title || 'تيك توك'}`);
        } else {
            await upd('❌ *فشل الإرسال.* الفيديو ممكن خاص أو محذوف.');
            await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
        }
    } catch (err) {
        console.error('[تيك2]', err?.message);
        await upd(`❌ *خطأ:* ${err?.message?.slice(0, 100)}`);
        await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
    }
}

export default { NovaUltra, execute };
