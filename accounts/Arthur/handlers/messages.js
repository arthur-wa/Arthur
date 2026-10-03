import { getPlugins, loadPlugins, getPluginIssues } from "./plugins.js";
import { handleRioAutoReply } from "./rio-core.js";
import configImport from "../nova/config.js"; 
import { playError, playOK } from "../utils/sound.js";
import elitePro from "./elite-pro.js";
import waUtils from "./waUtils.js";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import crypto from "crypto"; 
import { DisconnectReason } from '@whiskeysockets/baileys';
import { fileURLToPath } from 'url';


let plugins = null;
const messageBuffer = [];
let sockGlobal;
let systemListenerAttached = false;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const passwordPath = path.join(__dirname, "../../../ملف_الاتصال/Password.txt"); 
const configPath = path.join(process.cwd(), "nova", "config.js");


const dataDir = path.join(process.cwd(), "nova", "data");
const historyPath = path.join(dataDir, "History.txt");


if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}


export function logToHistory(logData) {
    try {
        const timestamp = new Date().toLocaleString('en-US', { hour12: false });

        const entry = `\n[${timestamp}]\n${logData}\n`;
        fs.appendFileSync(historyPath, entry, "utf8");
    } catch (e) {

    }
}


const SECRET_KEY = crypto.createHash('sha256').update('jnd_secure_session_v1').digest();

function decryptTextSafe(text) {
    try {
        const index = text.indexOf(':');
        if (index === -1) return null;
        const ivBase64 = text.slice(0, index);
        const data = text.slice(index + 1);
        const iv = Buffer.from(ivBase64, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
        let decrypted = decipher.update(data, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        return null;
    }
}

function getSystemPassword() {
    if (!fs.existsSync(passwordPath)) return null;
    try {
        const encryptedContent = fs.readFileSync(passwordPath, "utf8");
        const decryptedJson = decryptTextSafe(encryptedContent);
        if (decryptedJson) {
            const data = JSON.parse(decryptedJson);
            return data.password; 
        }
    } catch (e) {
        return null;
    }
    return null;
}


const normalizeJid = (jid) => jid ? jid.split('@')[0].split(':')[0] : '';


function getLiveSystemConfig() {
    try {
        const content = fs.readFileSync(configPath, "utf8");
        const prefixMatch = content.match(/let\s+prefix\s*=\s*['"](.*?)['"];/);
        const currentPrefix = prefixMatch ? prefixMatch[1] : configImport.prefix;
        const botMatch = content.match(/bot:\s*['"](on|off)['"]/);
        const modeMatch = content.match(/mode:\s*['"](on|off)['"]/);

        return {
            prefix: currentPrefix,
            botState: botMatch ? botMatch[1] : "on",
            modeState: modeMatch ? modeMatch[1] : "off"
        };
    } catch (e) {
        return { prefix: configImport.prefix, botState: "on", modeState: "off" };
    }
}

async function safeSendMessage(sock, jid, msg, options = {}) {
    try {
        return await sock.sendMessage(jid, msg, options);
    } catch (err) {
        if (err?.data === 429) {
            await new Promise(r => setTimeout(r, 2000));
            return await sock.sendMessage(jid, msg, options);
        }
        throw err;
    }
}


function attachSystemLogger(sock) {
    if (systemListenerAttached) return;

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            let logMsg = "";

            if (statusCode === 408) {
                logMsg = "⚠ [SYSTEM CRITICAL]: Internet Connection Lost (408).";
            } else if (statusCode === 440) {
                logMsg = "👮‍♂️ [SECURITY ALERT]: Session Conflict (440).";
            } else if (statusCode === DisconnectReason.loggedOut) {
                logMsg = "⛔ [SYSTEM]: Device Logged Out.";
            } else if (statusCode === DisconnectReason.forbidden) {
                logMsg = "🚫 [SYSTEM]: Account BANNED.";
            } else {
                logMsg = `ℹ [SYSTEM]: Connection Closed (${statusCode}).`;
            }
            
            
            logToHistory(`__________________\n${logMsg}\n__________________`);
        }
        
        if (connection === 'open') {
             logToHistory(`__________________\n✅ [SYSTEM]: Bot Connected (${sock.user?.id})\n__________________`);
        }
    });

    systemListenerAttached = true;
}


export async function initializePlugins(themeColor) {
    try {
        
        let hexColor = themeColor || '#00FF00';
        if (!hexColor.startsWith('#')) hexColor = '#' + hexColor;

        
        plugins = await loadPlugins(hexColor);
        
        
        console.log(chalk.hex(hexColor).bold("🔌 PLUGINS LOADED & READY."));
    } catch (err) {
        console.error("Error loading plugins:", err);
        logToHistory(`__________________\n❌ [ERROR]: Plugin Loading Failed\nMSG: ${err.message}\n__________________`); 
    }
}

export async function handleMessages(sock, { messages }) {
    sockGlobal = { ...sock, ...elitePro, ...waUtils };
    if (!sockGlobal.ev && sock.ev) sockGlobal.ev = sock.ev;

    attachSystemLogger(sock);

    // ── مستمع أحداث المجموعات (ترقية / إزالة إشراف) ──
    if (!sock._groupEvAttached) {
        sock.ev.on('group-participants.update', async (event) => {
            if (global.groupEvHandlers?.length) {
                for (const gh of global.groupEvHandlers) {
                    try { await gh(sock, event); } catch (e) {
                    }
                }
            }
        });
        sock._groupEvAttached = true;
    }

    if (!sockGlobal.activeListeners) {
        sockGlobal.activeListeners = new Map();
    }

    messageBuffer.push(...messages);
}

setInterval(async () => {
    if (messageBuffer.length === 0) return;
    const messagesToProcess = [...messageBuffer];
    messageBuffer.length = 0;
    
    for (const msg of messagesToProcess) {
        try {
            if (sockGlobal) await handleSingleMessage(sockGlobal, msg);
        } catch (err) { }
    }
}, 100);


async function handleSingleMessage(sock, msg) {
    if (!msg.message || !msg.key) return;

    const chatId = msg.key.remoteJid;

    if (sock.activeListeners && sock.activeListeners.has(chatId)) {
        return; 
    }

    const isGroup = chatId.endsWith("@g.us");
    const messageText = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.imageMessage?.caption || 
                        msg.message?.videoMessage?.caption || "";

    const { prefix, botState, modeState } = getLiveSystemConfig();

    // ── نظام الرد التلقائي "ريو" (يعمل فقط بالقروب المفعّل عبر أمر جلسة) ──
    if (isGroup) {
        try {
            const handled = await handleRioAutoReply(sock, msg, { isGroup, chatId, messageText, prefix });
            if (handled) return; // تم الرد — لا داعي لمتابعة أي معالجة إضافية
        } catch (e) {}
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!messageText.startsWith(prefix)) return;

    // ── معالجة الأوامر العادية ──

    const BIDS = {
        pn: sock.user.id.split(":")[0] + "@s.whatsapp.net",
        lid: sock.user.lid?.split(":")[0] + "@lid",
    };

    const sender = {
        name: msg.pushName || "Unknown",
        pn: msg.key.participantAlt || 
            (msg.key.remoteJidAlt?.endsWith("s.whatsapp.net") && msg.key.fromMe ? BIDS.pn : msg.key.remoteJidAlt) || 
            (msg.key.fromMe ? BIDS.pn : (isGroup ? msg.key.participant : chatId)),
        lid: msg.key.participant || 
             (msg.key.remoteJid?.endsWith("lid") && msg.key.fromMe ? BIDS.lid : msg.key.remoteJid) || 
             null,
    };

    if (sender.pn) sender.pn = normalizeJid(sender.pn) + "@s.whatsapp.net";

    const args = messageText.slice(prefix.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();
    
    if (!command) return;


    const ownerNumber = configImport.owner ? configImport.owner.toString().replace(/\D/g, '') : '';
    const isOwner = sender.pn === (ownerNumber + "@s.whatsapp.net");

    let senderIsElite = false;
    try { senderIsElite = await sock.isElite({ sock, id: sender.pn }); } catch (e) {}

    const senderRole = msg.key.fromMe ? "BOT" : (isOwner ? "OWNER" : "USER");
    const eliteStatus = senderIsElite ? "YES" : "NO";
    const locationType = isGroup ? "GROUP" : "PRIVATE"; 

    
    let ignoreReason = null;
    

    if (botState === "off" && command !== "اعدادات" && command !== "bot") {
        ignoreReason = "BOT : OFF = IGNORED";
    } 

    else if (modeState === "on" && !senderIsElite && !msg.key.fromMe && !isOwner) {
        ignoreReason = "MODE : ON = IGNORED";
    }

    let logDetails = `__________________
SENDER : ${senderRole}
CMD    : ${command}
JID    : ${sender.pn}
LID    : ${sender.lid}
LOC    : ${locationType}
ELITE  : ${eliteStatus}`;

    if (ignoreReason) {
        logDetails += `\n${ignoreReason}`;
    }
    logDetails += `\n__________________`;

    console.log(chalk.cyan(`__________________`));
    console.log(chalk.green(`SENDER : ${senderRole}`));
    console.log(chalk.bold.white(`CMD    : ${command}`));
    console.log(chalk.yellow(`JID    : ${sender.pn}`));
    console.log(chalk.magenta(`LID    : ${sender.lid}`));
    console.log(chalk.blue(`LOC    : ${locationType}`));
    console.log(chalk.red(`ELITE  : ${eliteStatus}`));

    if (ignoreReason) {
        console.log(chalk.bgRed.white.bold(ignoreReason));
    }
    console.log(chalk.cyan(`__________________`));

    logToHistory(logDetails);

    if (ignoreReason) return;

    plugins = getPlugins();
    const handler = plugins[command];

    if (!handler && !["حدث", "مشاكل"].includes(command)) {
        console.log(chalk.hex('#FFA500')(`COMMAND UNKNOWN: ${command}`));
        logToHistory(`__________________\nUNKNOWN: ${command}\nSENDER: ${sender.pn}\n__________________`);
        return;
    }

    
    if (command === "حدث") {
        if (!senderIsElite && !msg.key.fromMe && !isOwner) return;
        try {
            await loadPlugins();
            console.log(chalk.green(`SYSTEM: Reloaded`));
            return await safeSendMessage(sock, chatId, { react: { text: "✅", key: msg.key } });
        } catch (err) { 
            playError(); 
            logToHistory(`__________________\n[ERROR] RELOAD FAILED\nMSG: ${err.message}\n__________________`); 
            return; 
        }
    }

    if (command === "مشاكل") {
        if (!senderIsElite && !msg.key.fromMe && !isOwner) return;
        const issues = getPluginIssues();
        const text = issues.length ? `⚠ مشاكل البلوجينات:\n\n${issues.join("\n")}` : "✨ لا توجد مشاكل برمجية.";
        return await safeSendMessage(sock, chatId, { text }, { quoted: msg });
    }

    if (!handler) return;

    msg.chat = chatId;
    msg.args = args;
    msg.sender = sender;

    if (handler.group === true && !isGroup) {
        return await safeSendMessage(sock, chatId, { text: "❗ هذا الأمر يعمل في المجموعات فقط." }, { quoted: msg });
    }
    if (handler.prv === true && isGroup) {
        return await safeSendMessage(sock, chatId, { text: "❗ هذا الأمر يعمل في الخاص فقط." }, { quoted: msg });
    }


    const executeWithPermissions = async () => {
        if (handler.elite === "on" && !senderIsElite && !msg.key.fromMe && !isOwner) {
            return await safeSendMessage(sock, chatId, { text: "تسويها ثاني تنجلد" }, { quoted: msg });
        }

        try {

            const originalIsElite = sock.isElite;
            

            sock.isElite = async (opts) => {
                const idToCheck = opts?.id || opts;
                if (normalizeJid(idToCheck) === normalizeJid(ownerNumber)) {
                    return true; 
                }
                return originalIsElite ? await originalIsElite(opts) : false;
            };

            await handler.execute({ sock, msg, args, BIDS, sender, command });
            

            sock.isElite = originalIsElite;
            
            playOK();
        } catch (err) {
            console.error(`❌ Error in ${command}:`, err);
            logToHistory(`__________________\n[ERROR] EXECUTION FAILED\nCMD: ${command}\nMSG: ${err.message}\n__________________`); 
            playError();
            await safeSendMessage(sock, chatId, { text: `❌ خطأ برمجي:\n${err.message}` }, { quoted: msg });
        }
    };


    if (handler.lock === "on" && !msg.key.fromMe && !isOwner) {
        const storedPassword = getSystemPassword();
        
        if (!storedPassword) {
            await executeWithPermissions();
            return;
        }

        const password = storedPassword.trim().toUpperCase();

        await safeSendMessage(sock, chatId, { react: { text: "🔐", key: msg.key } });
        console.log(chalk.cyan(`[LOCK] Password Required for ${command}`));
        logToHistory(`__________________\n[LOCK] REQ PASS\nCMD: ${command}\nUSER: ${sender.pn}\n__________________`); 

        let attempts = 0;
        
        const cleanupLock = () => {
            clearTimeout(timeoutId);
            sock.ev.off("messages.upsert", lockListener);
            sock.activeListeners.delete(chatId);
        };

        sock.activeListeners.set(chatId, cleanupLock);

        const timeoutId = setTimeout(async () => {
            cleanupLock();
            console.log(chalk.red(`[LOCK] TIMEOUT`));
            logToHistory(`__________________\n[LOCK] TIMEOUT\nCMD: ${command}\n__________________`);
            await safeSendMessage(sock, chatId, { react: { text: "🔒", key: msg.key } });
        }, 30000);

        const lockListener = async ({ messages }) => {
            const m = messages[0];
            if (!m.message) return;

            const input = (m.message.conversation || m.message.extendedTextMessage?.text || "").trim();
            if (!input) return;

            const incomingIsGroup = m.key.remoteJid.endsWith("@g.us");
            const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";

            const rawSenderPn = m.key.participantAlt || 
                               (m.key.remoteJidAlt?.endsWith("s.whatsapp.net") && m.key.fromMe ? botJid : m.key.remoteJidAlt) || 
                               (m.key.fromMe ? botJid : (incomingIsGroup ? m.key.participant : m.key.remoteJid));

            if (!rawSenderPn) return;

            const incomingJidPure = normalizeJid(rawSenderPn);
            const originalSenderPure = normalizeJid(sender.pn);
            const originalChatPure = normalizeJid(chatId);
            const currentChatPure = normalizeJid(m.key.remoteJid);

            const listenerRole = m.key.fromMe ? "BOT" : (isOwner ? "OWNER" : "USER");
            const listenerLoc = incomingIsGroup ? "GROUP" : "PRIVATE";

            const isSameUser = incomingJidPure === originalSenderPure;
            const isSameChat = currentChatPure === originalChatPure;
            const isPrivate = !incomingIsGroup;

            const isPasswordCorrect = input.toUpperCase() === password;
            const passStatus = isPasswordCorrect ? "TRUE" : "FALSE";
            
            const listenerLog = `__________________
[LOCK LISTENER]
SENDER : ${listenerRole}
INPUT  : ${input}
JID    : ${incomingJidPure}
LOC    : ${listenerLoc}
MATCH  : ${passStatus}
__________________`;

            console.log(chalk.bgBlue.white(` [LOCK LISTENER] `));
            console.log(chalk.cyan(`SENDER : ${listenerRole}`));
            console.log(chalk.white(`INPUT  : ${input}`));
            console.log(chalk.yellow(`JID    : ${incomingJidPure}@s.whatsapp.net`));
            console.log(chalk.blue(`LOC    : ${listenerLoc}`));
            
            if (!isSameUser) return;
            if (!isSameChat && !isPrivate) return;

            logToHistory(listenerLog);

            console.log(chalk.bold(isPasswordCorrect ? chalk.green(`PASS MATCH : TRUE`) : chalk.red(`PASS MATCH : FALSE`)));
            console.log(chalk.cyan(`__________________`));

            if (isPasswordCorrect) {
                cleanupLock();
                await safeSendMessage(sock, m.key.remoteJid, { react: { text: "✅", key: m.key } });
                await safeSendMessage(sock, chatId, { react: { text: "🔓", key: msg.key } });
                await executeWithPermissions();
            } else {
                attempts++;
                logToHistory(`__________________\n[LOCK] WRONG PASS (${attempts}/3)\nUSER: ${incomingJidPure}\n__________________`); 
                
                playError();
                await safeSendMessage(sock, m.key.remoteJid, { react: { text: "❌", key: m.key } });

                if (attempts >= 3) {
                    cleanupLock();
                    await safeSendMessage(sock, chatId, { react: { text: "🔒", key: msg.key } });
                }
            }
        };

        sock.ev.on("messages.upsert", lockListener);
        
    } else {
        await executeWithPermissions();
    }
}
