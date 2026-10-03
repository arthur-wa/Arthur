// ══════════════════════════════════════════════════════════════
//  نسخ.js — ضغط مجلد العمل بأقصى درجة وإرساله إلى تليجرام
// ══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';

const execAsync = promisify(exec);

const NovaUltra = {
    command: ['نسخ', 'backup', 'تصدير'],
    description: 'يقوم بضغط مجلد العمل بالكامل بأقصى درجة وإرساله لتليجرام',
    elite: 'on', // متاح للمطورين فقط لحماية البيانات
    group: false,
    prv: false,
    lock: 'off'
};

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;
    
    // التفاعل المبدئي بالانتظار
    await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } }).catch(() => {});

    const TG_TOKEN = '8986531958:AAE2vmdoGmWQmZeR1wvCDxl3EcxjKOfcICo';
    const TG_CHAT_ID = '8665084844';
    
    const tmpDir = '/home/abdozaik720/art/tmp';
    await fs.ensureDir(tmpDir);
    const outputFile = path.join(tmpDir, `art_backup_${Date.now()}.tar.gz`);

    try {
        // تنفيذ أمر ضغط المجلد كـ tar وإرساله عبر gzip -9 للحصول على أعلى معدل ضغط
        // يتم تضمين المكاتب (node_modules) بناءً على الطلب، مع استثناء ملف الجلسة (ملف_الاتصال) للأمان
        // تم استثناء .git و tmp لتقليل الحجم غير الضروري
        const cmd = `tar --exclude='ملف_الاتصال' --exclude='.git' --exclude='tmp' -cf - -C /home/abdozaik720 art | gzip -9 > "${outputFile}"`;
        await execAsync(cmd);

        if (!fs.existsSync(outputFile)) {
            throw new Error('فشل إنشاء ملف الضغط التراكمي.');
        }

        const stats = await fs.stat(outputFile);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        const caption = `📦 *نسخة احتياطية لمجلد art*\n\n🗜️ نوع الضغط: أقصى درجة (gzip -9)\n📊 الحجم النهائي: ${sizeInMB} MB\n🚀 تم الرفع عبر محرك Python.`;

        // استدعاء سكربت البايثون للرفع لتجاوز حدود Node.js و Axios
        const pythonScript = '/home/abdozaik720/art/accounts/Arthur/plugins/tools/uploader.py';
        const uploadCmd = `python3 "${pythonScript}" "${TG_TOKEN}" "${TG_CHAT_ID}" "${outputFile}" "${caption}"`;
        
        const { stdout } = await execAsync(uploadCmd);
        if (!stdout.includes('UPLOAD_SUCCESS')) {
            throw new Error(stdout);
        }

        // تأكيد النجاح في الواتساب
        await sock.sendMessage(chatId, { text: `✅ *تمت العملية بنجاح!*\n\n📊 الحجم المضغوط: *${sizeInMB} MB*\n📬 تم إرسال الملف المضغوط إلى حساب التليجرام الخاص بك.` }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }).catch(() => {});

    } catch (error) {
        console.error('[Backup Error]:', error);
        await sock.sendMessage(chatId, { text: `❌ *حدث خطأ أثناء العملية:*\n\`\`\`${error.message}\`\`\`` }, { quoted: msg });
        await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }).catch(() => {});
    } finally {
        // تنظيف وحذف الملف المضغوط من السيرفر فوراً لعدم استهلاك المساحة
        if (fs.existsSync(outputFile)) {
            await fs.remove(outputFile).catch(() => {});
        }
    }
}

export default { NovaUltra, execute };