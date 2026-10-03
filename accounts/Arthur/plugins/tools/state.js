import { jidDecode } from "@whiskeysockets/baileys";

const NovaUltra = {
    command: "حالة",
    description: "عرض حالة البوت والسرعة والمدة.",
    elite: "off",
    group: false,
    prv: false,
    lock: "off"
};

async function execute({ sock, msg }) {
    const m = msg; 

    try {
        const jid = m.key.remoteJid;
        
        const start = Date.now();

        
        const uptimeSeconds = process.uptime();
        const uptimeFormatted = new Date(uptimeSeconds * 1000).toISOString().substr(11, 8);
        
        const end = Date.now();
        const ping = end - start; 
        
        const statusMessage = `🟢 *حالة البوت:*
⏳ *السرعة:* ${ping}ms
⏱️ *المدة:* ${uptimeFormatted}`;

        await sock.sendMessage(jid, { text: statusMessage }, { quoted: m });
        
    } catch (error) {
        console.error("❌ خطأ في كود حالة البوت:", error);
        await sock.sendMessage(m.key.remoteJid, { text: "❌ حدث خطأ أثناء جلب حالة البوت." }, { quoted: m });
    }
}

export default { NovaUltra, execute };
