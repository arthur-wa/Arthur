function reply(sock, chatId, text, msg) {
    return sock.sendMessage(chatId, { text }, { quoted: msg });
}

const NovaUltra = {
    command: ['اخرج', 'اطلع'],
    description: 'يخرج البوت من المجموعة',
    elite: 'off', group: true, prv: false, lock: 'off'
};

async function execute({ sock, msg, args, sender }) {
    const chatId   = msg.key.remoteJid;
    const ownerNum = (global.config?.owner || '').toString().replace(/\D/g, '');
    const isOwner  = (sender?.pn || '').includes(ownerNum);
    if (!isOwner) return;

    const targetId = args[0] || chatId;
    await reply(sock, targetId, 'ههه يبزران', msg);
    await sock.groupLeave(targetId);
}

export default { NovaUltra, execute };
