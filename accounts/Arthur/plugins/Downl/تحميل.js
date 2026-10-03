//  تحميل.js — تحميل سريع من أي منصة

import { spawn } from 'child_process';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const HELPER = path.join(path.dirname(new URL(import.meta.url).pathname), 'dl_helper.py');
const TIKWM = 'https://www.tikwm.com';
const TIKWM_H = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/116.0 Mobile Safari/537.36',
};

const NovaUltra = {
    command:     ['تحميل', 'تنزيل', 'download', 'dl'],
    description: 'تحميل فيديو/صوت من أي منصة',
    elite:       'off',
    group:       false,
    prv:         false,
    lock:        'off',
};

function isTikTok(url) {
    return /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url);
}

function runPython(url, outDir, mode) {
    return new Promise((resolve, reject) => {
        const proc = spawn('python3', [HELPER, url, outDir, mode], {
            timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => {
            if (code !== 0) return reject(new Error(stderr.slice(0, 200)));
            try { resolve(JSON.parse(stdout.trim())); }
            catch { reject(new Error('فشل قراءة النتيجة')); }
        });
        proc.on('error', reject);
    });
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`FFmpeg failed: ${stderr.slice(0, 200)}`));
        });
        proc.on('error', reject);
    });
}

async function downloadTikTok(url) {
    const params = new URLSearchParams({ url, hd: '1' });
    const { data } = await axios.post(`${TIKWM}/api/`, params.toString(), {
        headers: TIKWM_H, timeout: 20_000,
    });
    const d = data?.data;
    if (!d) throw new Error('فشل جلب بيانات تيك توك');

    const videoUrl = d.hdplay || d.play;
    if (!videoUrl) throw new Error('الفيديو غير متاح');

    const res = await axios.get(videoUrl, {
        responseType: 'arraybuffer', timeout: 60_000,
        headers: { 'User-Agent': TIKWM_H['User-Agent'], Referer: 'https://www.tiktok.com/' },
    });
    return Buffer.from(res.data);
}

async function downloadTikTokAudio(url) {
    const params = new URLSearchParams({ url, hd: '1' });
    const { data } = await axios.post(`${TIKWM}/api/`, params.toString(), {
        headers: TIKWM_H, timeout: 20_000,
    });
    const musicUrl = data?.data?.music;
    if (!musicUrl) throw new Error('الصوت غير متاح');

    const res = await axios.get(musicUrl, {
        responseType: 'arraybuffer', timeout: 30_000,
        headers: { 'User-Agent': TIKWM_H['User-Agent'] },
    });
    return Buffer.from(res.data);
}

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    const input = args.join(' ').trim();

    if (!input || !/^https?:\/\//i.test(input)) {
        await sock.sendMessage(chatId, {
            text: `📥 *تحميل*\n\n• \`تحميل <رابط>\`\n• \`تحميل صوت <رابط>\``,
        }, { quoted: msg });
        return;
    }

    const audioOnly = args.some(a => ['صوت', 'aud', 'mp3'].includes(a.toLowerCase()));

    await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

    let tmpDir;
    try {
        let buf;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-'));

        if (isTikTok(input)) {
            if (audioOnly) {
                buf = await downloadTikTokAudio(input);
            } else {
                const rawBuf = await downloadTikTok(input);
                const inPath = path.join(tmpDir, 'tk_in.mp4');
                const outPath = path.join(tmpDir, 'tk_out.mp4');
                await fs.writeFile(inPath, rawBuf);
                await runFfmpeg(['-y', '-i', inPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outPath]);
                buf = await fs.readFile(outPath);
            }
        } else {
            const result = await runPython(input, tmpDir, audioOnly ? 'audio' : 'video');
            if (!result.file || !(await fs.stat(result.file).catch(() => null))) {
                throw new Error('الملف غير موجود بعد التحميل');
            }
            if (audioOnly) {
                buf = await fs.readFile(result.file);
            } else {
                const outPath = path.join(tmpDir, 'video_out.mp4');
                await runFfmpeg([
                    '-y', '-i', result.file, '-vf', "scale='min(1280,iw)':'-2'",
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outPath
                ]);
                buf = await fs.readFile(outPath);
            }
        }

        if (audioOnly) {
            await sock.sendMessage(chatId, {
                audio: buf, mimetype: 'audio/mpeg', ptt: false,
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                video: buf, mimetype: 'video/mp4',
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, { react: { text: '✔️', key: msg.key } }).catch(() => {});

    } catch (err) {
        console.error('[تحميل]', err?.message);
        await sock.sendMessage(chatId, { react: { text: '✖️', key: msg.key } }).catch(() => {});
        await sock.sendMessage(chatId, {
            text: `❌ ${(err?.message || 'خطأ').slice(0, 100)}`,
        }, { quoted: msg }).catch(() => {});

    } finally {
        if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
}

export default { NovaUltra, execute };
