// ══════════════════════════════════════════════════════════════
//  rio.js — أمر "كتابة": يعرض قائمة القروبات ويحدد القروب المفعّل
//  لميزة الرد التلقائي (المنطق الفعلي بملف handlers/rio-core.js)
//
//  ⚠ هذا الملف لازم يكون بمجلد plugins/ (نفس مسار باقي البلوجينات
//     مثل غزو-1.js) عشان loadPlugins() تكتشفه وتربطه بالأمر.
//  ⚠ عدّل السطر التالي إذا كان مسار مجلد handlers مختلف عندك:
// ══════════════════════════════════════════════════════════════

import { loadState, saveState, randMistakeGap } from "../../handlers/rio-core.js";

export const NovaUltra = {
    command: ["كتابة"],
    description: "يفتح قائمة القروبات لتحديد القروب المفعّل لميزة الرد التلقائي",
    elite: "off",
    group: false,
    prv: false,
    lock: "off",
};

const activeListeners = new Map(); // chatId -> listener
const sessionTimeouts = new Map();

function clearSession(chatId, sock) {
    const listener = activeListeners.get(chatId);
    if (listener && sock?.ev) sock.ev.off("messages.upsert", listener);
    activeListeners.delete(chatId);
    const t = sessionTimeouts.get(chatId);
    if (t) clearTimeout(t);
    sessionTimeouts.delete(chatId);
}

function resetTimeout(chatId, sock) {
    const t = sessionTimeouts.get(chatId);
    if (t) clearTimeout(t);
    sessionTimeouts.set(
        chatId,
        setTimeout(() => clearSession(chatId, sock), 60000)
    );
}

export async function execute({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;

    if (activeListeners.has(chatId)) {
        await sock.sendMessage(
            chatId,
            { text: "⏳ _لديك جلسة اختيار نشطة، أكمل من حيث توقفت أو اكتب *الغاء*._" },
            { quoted: msg }
        );
        return;
    }

    let groupsMap;
    try {
        groupsMap = await sock.groupFetchAllParticipating();
    } catch (err) {
        await sock.sendMessage(
            chatId,
            { text: `❌ تعذّر جلب القروبات: ${err.message?.slice(0, 100)}` },
            { quoted: msg }
        );
        return;
    }

    const groups = Object.values(groupsMap || {});
    if (!groups.length) {
        await sock.sendMessage(chatId, { text: "❌ لا توجد قروبات." }, { quoted: msg });
        return;
    }

    const state = loadState();

    const listText = groups
        .map((g, i) => `*${i + 1}.* ${g.subject}${g.id === state.activeChat ? "  ✅ (مفعّل حالياً)" : ""}`)
        .join("\n");

    await sock.sendMessage(
        chatId,
        {
            text:
`📋 *اختر القروب المراد تفعيل الرد فيه:*

${listText}

_اكتب رقم القروب، أو اكتب *الغاء* للخروج_`,
        },
        { quoted: msg }
    );

    resetTimeout(chatId, sock);

    const listener = async ({ messages, type }) => {
        if (type !== "notify") return;
        const m = messages[0];
        if (!m?.message || m.key.remoteJid !== chatId) return;
        if (m.key.fromMe && m.key.id === msg.key.id) return; // تجاهل رسالة الأمر نفسها

        const text = (
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            ""
        ).trim();
        if (!text) return;

        resetTimeout(chatId, sock);

        const lower = text.toLowerCase();
        if (lower === "الغاء" || lower === "إلغاء" || lower === "cancel") {
            clearSession(chatId, sock);
            await sock.sendMessage(chatId, { text: "✅ _تم إلغاء الجلسة._" });
            return;
        }

        const num = parseInt(text);
        if (isNaN(num) || num < 1 || num > groups.length) {
            await sock.sendMessage(chatId, {
                text: `⚠️ _اكتب رقماً بين 1 و ${groups.length}، أو *الغاء*_`,
            });
            return;
        }

        const chosen = groups[num - 1];
        const freshState = loadState();
        freshState.activeChat = chosen.id;
        freshState.streak = 0;
        freshState.nextMistakeAt = randMistakeGap();
        saveState(freshState);

        clearSession(chatId, sock);

        await sock.sendMessage(chatId, {
            text: `✅ *تم تفعيل الرد التلقائي في:*\n📌 ${chosen.subject}`,
        });
    };

    activeListeners.set(chatId, listener);
    sock.ev.on("messages.upsert", listener);
}

export default { NovaUltra, execute };
