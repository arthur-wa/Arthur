// ══════════════════════════════════════════════════════════════
//  rio-core.js — المنطق المشترك لميزة الرد التلقائي "ريو"
//  يوضع بمجلد handlers/ (جنب messages.js)
//  يُستورد من مكانين: messages.js (للرد التلقائي) و plugins/rio.js (لأمر كتابة)
// ══════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "nova", "data");
const STATE_PATH = path.join(DATA_DIR, "rio_state.json");

// ذاكرة مؤقتة للحالة لتجنب القراءة المستمرة من القرص
let cachedState = null;

function randMistakeGap() {
    return Math.floor(Math.random() * (12 - 4 + 1)) + 4;
}

export function loadState() {
    if (cachedState) return cachedState;
    try {
        if (fs.existsSync(STATE_PATH)) {
            cachedState = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
            return cachedState;
        }
    } catch {}
    return { activeChat: null, streak: 0, nextMistakeAt: randMistakeGap() };
}

export function saveState(state) {
    try {
        cachedState = state;
        fs.mkdirSync(DATA_DIR, { recursive: true });
        // الكتابة بشكل غير متزامن أحياناً أفضل، لكن سنبقيها متزامنة مع تحديث الكاش
        fs.writeFileSync(STATE_PATH, JSON.stringify(state), "utf8");
    } catch {}
}

export { randMistakeGap };

// ══════════════════════════════════════════════════════════════
//  فحص: هل النص محاط بنجوم *...* أو أقواس زخرفية ⟦...⟧
//  أو نمط ⧉┊...🖋️ ؟ لازم أحد الأشكال يكون موجوداً وإلا نتجاهل
// ══════════════════════════════════════════════════════════════
export function hasRequiredWrapper(raw) {
    if (!raw) return false;
    const hasBrackets = /⟦[^⟧]*⟧/.test(raw);
    const hasStars = /\*[^*]+\*/.test(raw);
    const hasRamStyle = /⧉┊[^\n]*🖋️/.test(raw);
    const hasPenStyle = /✒️/.test(raw); // قلم لحاله بالبداية أو النهاية
    return hasBrackets || hasStars || hasRamStyle || hasPenStyle;
}

// ══════════════════════════════════════════════════════════════
//  تنظيف النص: إزالة النجوم/الرموز/الإيموجي/المسافات الزائدة
// ══════════════════════════════════════════════════════════════
export function cleanText(raw) {
    if (!raw) return "";
    let t = raw;

    // نمط ⧉┊المحتوى🖋️ — نسحب ما بين ⧉┊ و🖋️ تحديداً (قبل شيل أي إيموجي)
    const ramMatch = t.match(/⧉┊([^\n]*?)🖋️/);
    if (ramMatch) {
        t = ramMatch[1];
    } else if (/\|/.test(t)) {
        // نمط "كتابة | ريو" — نأخذ ما بعد آخر فاصل | تحديداً
        const parts = t.split("|");
        t = parts[parts.length - 1];
    } else {
        // لو النص يحتوي على قوسين زخرفيين ⟦...⟧ نأخذ المحتوى الفعلي بينهما فقط
        const bracketMatch = t.match(/⟦([^⟧]*)⟧/);
        if (bracketMatch) t = bracketMatch[1];
    }

    // نشيل أي إيموجي متبقي من الجزء المستخرَج (يشمل الأعلام مثل 🇵🇸 والرموز مثل 🔰)
    t = t.replace(
        /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu,
        ""
    );
    t = t.replace(/[*_~`⟦⟧「」『』【】〔〕《》〈〉""''""''.,!؟?٬،:؛\-_=+#|\\/()<>\[\]{}⧉┊]/g, "");
    t = t.replace(/\s+/g, " ").trim();

    return t;
}

// ══════════════════════════════════════════════════════════════
//  تشويه بسيط لحرف واحد قريب
// ══════════════════════════════════════════════════════════════

// تباطؤ عشوائي أحياناً قبل الرد (مو دايماً) — يخلي الرد يحس طبيعي أكثر
const SLOW_CHANCE = 0.15;        // احتمال حدوث تباطؤ (20% من الردود)
const SLOW_MIN_MS = 500;       // أقل مدة تأخير
const SLOW_MAX_MS = 900;       // أكبر مدة تأخير

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const processedIds = new Set();
const MAX_PROCESSED_CACHE = 500;

function alreadyProcessed(msgId) {
    if (!msgId) return false;
    if (processedIds.has(msgId)) return true;
    processedIds.add(msgId);
    if (processedIds.size > MAX_PROCESSED_CACHE) {
        const first = processedIds.values().next().value;
        processedIds.delete(first);
    }
    return false;
}

// ══════════════════════════════════════════════════════════════
//  الدالة المستدعاة من messages.js لكل رسالة عادية داخل القروبات
// ══════════════════════════════════════════════════════════════
export async function handleRioAutoReply(sock, msg, { isGroup, chatId, messageText, prefix }) {
    try {
        if (!isGroup) return false;

        const msgId = msg.key?.id;
        if (alreadyProcessed(msgId)) return false; // نفس الرسالة سبق ورُدّ عليها — تجاهل

        let state = loadState();
        if (!state.activeChat || chatId !== state.activeChat) return false;
        if (msg.key.fromMe) return false; // ما يرد على نفسه
        if (!messageText) return false;
        if (messageText.startsWith(prefix)) return false; // مو أمر
        if (!hasRequiredWrapper(messageText)) return false; // لازم يكون فيه نجوم *..* أو أقواس ⟦..⟧

        const cleaned = cleanText(messageText);
        if (!cleaned) return false;
        if (cleaned.length > 20) return false; // رفع الحد المسموح لطول الكلمة لضمان عدم التجاهل

        state.streak += 1;

        let replyText = cleaned;

        saveState(state);

        // تباطؤ عشوائي أحياناً قبل الإرسال (مو دايماً)
        if (Math.random() < SLOW_CHANCE) {
            const delay = Math.floor(Math.random() * (SLOW_MAX_MS - SLOW_MIN_MS + 1)) + SLOW_MIN_MS;
            await sleep(delay);
        }

        await sock.sendMessage(chatId, { text: replyText });
        return true;
    } catch (err) {
        return false;
    }
}
