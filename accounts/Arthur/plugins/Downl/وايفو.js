import axios from 'axios';

function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}
function react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
}

const NovaUltra = {
    command: ['ساكو', 'waifu'],
    description: 'صورة وايفو عشوائية 🌸',
    elite: 'off',
    group: false,
    prv: false,
    lock: 'off',
};

async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;
    try {
        await react(sock, msg, '🕒');

        // قائمة بمصادر بديلة لزيادة الاعتمادية
        const sources = [
            { url: 'https://api.waifu.pics/sfw/waifu', transform: d => d?.url },
            { url: 'https://nekos.best/api/v2/waifu', transform: d => d?.results?.[0]?.url }
        ];

        let url = null;
        for (const source of sources) {
            try {
                const res = await axios.get(source.url, { timeout: 8000 });
                url = source.transform(res.data);
                if (url) break;
            } catch (err) {
                continue; // تجربة المصدر التالي في حال فشل الحالي
            }
        }

        if (!url) throw new Error('لم يتم العثور على صورة');
        await sock.sendMessage(chatId, { image: { url }, caption: '*❀ Take this wife* ฅ^•ﻌ•^ฅ' }, { quoted: msg });
        await react(sock, msg, '✔️');
    } catch (e) {
        await react(sock, msg, '✖️');
        await reply(sock, chatId, `⚠︎ حدثت مشكلة:\n> ${e.message}`, msg);
    }
}

export default { NovaUltra, execute };
