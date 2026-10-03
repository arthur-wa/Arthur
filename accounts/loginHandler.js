import { generateWAMessageFromContent } from '@whiskeysockets/baileys';
import fs from 'fs-extra';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import chalk from 'chalk';
import delay from 'delay';
import * as accountUtils from './accountUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    } catch (err) { return null; }
}

function getTargetAccountPassword(accountName) {
    const pathInsideAccount = join(__dirname, accountName, 'ملف_الاتصال', 'Password.txt');
    const pathInRoot = join(resolve(__dirname, '..'), 'ملف_الاتصال', 'Password.txt');
    let targetPassFile = null;

    if (fs.existsSync(pathInRoot)) targetPassFile = pathInRoot;
    else if (fs.existsSync(pathInsideAccount)) targetPassFile = pathInsideAccount;

    if (!targetPassFile) return null;

    try {
        const encrypted = fs.readFileSync(targetPassFile, 'utf8');
        const decryptedJson = decryptTextSafe(encrypted);
        if (decryptedJson) {
            const data = JSON.parse(decryptedJson);
            if (data && data.password) return data.password.toUpperCase();
        }
    } catch (e) {}
    return null;
}

const userSessions = new Map();

const UI_HEADER = "*🌌 𝐴𝑁𝐴𝑆𝑇𝐴𝑆𝐼𝐴 𝑁𝑂𝑉𝐴 𝑈𝐿𝑇𝑅𝐴 🌌*";
const CREATE_ACC_PROMPT = `${UI_HEADER}\n\n\`يرجى اختيار اسم للحساب :\`\n\n`;
const CREATE_PASS_PROMPT = `${UI_HEADER}\n\n\`🔐 يرجى تعيين كلمة مرور للحساب (تستخدم لتشفير الملفات) :\`\n\n_مسموح فقط بالأحرف الإنجليزية والأرقام._\n`;

export async function handleLoginMessage(sock, msg) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    if (!msg.message) return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!text) return;

    const input = text.trim();
    const cleanInput = input.toLowerCase();

    let session = userSessions.get(chatId) || { state: 'IDLE', botMsgKey: null, userId: null };

    if (session.userId && session.userId !== sender) {
        return;
    }

    const ignoredStarts = [
        "*🌌 𝐴𝑁𝐴𝑆𝑇𝐴𝑆𝐼𝐴 𝑁𝑂𝑉𝐴 𝑈𝐿𝑇𝑅𝐴 🌌*", "👋 اهلاً، يرجى كتابة", "❌", "✅", "⏳", "⚠️", "🚫", "🔓", "🔐",
        "*👥 يرجى كتابة رقم", "🔒 هذا الحساب محمي", "تم الغاء الحذف", "🔐 يرجى ادخال كلمة السر"
    ];

    if (ignoredStarts.some(prefix => text.trim().startsWith(prefix))) return;

    const updateOrSend = async (text) => {
        try {
            if (session.botMsgKey) await sock.sendMessage(chatId, { text: text, edit: session.botMsgKey });
            else {
                const sent = await sock.sendMessage(chatId, { text: text }, { quoted: msg });
                session.botMsgKey = sent.key;
            }
        } catch (e) {
            const sent = await sock.sendMessage(chatId, { text: text }, { quoted: msg });
            session.botMsgKey = sent.key;
        }
        userSessions.set(chatId, session);
    };

    const sendTempError = async (errorMsg, originalInterface) => {
        await updateOrSend(errorMsg);
        await delay(2000); 
        await updateOrSend(originalInterface);
    };

    if (cleanInput === 'start' || cleanInput === '.start') {
        const masterAcc = accountUtils.getMasterAccountName();
        if (!masterAcc) {
            session = { state: 'SETUP_MASTER', botMsgKey: null, userId: sender };
            const sent = await sock.sendMessage(chatId, { text: CREATE_ACC_PROMPT }, { quoted: msg });
            session.botMsgKey = sent.key;
            userSessions.set(chatId, session);
            return;
        }

        if (!msg.key.fromMe) {
            const savedPass = getTargetAccountPassword(masterAcc);
            if (savedPass) {
                await sock.sendMessage(chatId, { react: { text: "🔐", key: msg.key } });
                session = { 
                    state: 'START_PASSWORD_CHECK', 
                    botMsgKey: null, 
                    userId: sender, 
                    targetPass: savedPass, 
                    attempts: 0 
                };
                setupPasswordTimeout(chatId, session, sock, updateOrSend);
                userSessions.set(chatId, session);
                return;
            }
        }

        session = { state: 'MAIN_MENU', botMsgKey: null, userId: sender };
        const sent = await sock.sendMessage(chatId, { text: "👋 اهلاً، يرجى كتابة *بدء* او *تفاصيل*" }, { quoted: msg });
        session.botMsgKey = sent.key;
        userSessions.set(chatId, session);
        return;
    }

    if (session.state === 'START_PASSWORD_CHECK') {
        if (session.timeoutId) clearTimeout(session.timeoutId);
        
        if (input.toUpperCase() === session.targetPass) {
            await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
            session.state = 'MAIN_MENU';
            session.attempts = 0;
            session.targetPass = null;
            const sent = await sock.sendMessage(chatId, { text: "👋 اهلاً، يرجى كتابة *بدء* او *تفاصيل*" }, { quoted: msg });
            session.botMsgKey = sent.key;
            userSessions.set(chatId, session);
        } else {
            session.attempts++;
            await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
            if (session.attempts >= 3) {
                 userSessions.delete(chatId);
            } else {
                setupPasswordTimeout(chatId, session, sock, updateOrSend);
            }
        }
        return;
    }

    if (session.state === 'DECRYPT_CHECK') {
        if (cleanInput === 'رجوع') {
            await showAccountsList(updateOrSend);
            session.state = 'SELECT_ACCOUNT';
            session.targetAccount = null;
            userSessions.set(chatId, session);
            return;
        }

        const passwordInput = input; 
        await sock.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

        const unlockResult = accountUtils.unlockAccount(session.targetAccount, passwordInput);

        if (unlockResult.success) {
            await sock.sendMessage(chatId, { react: { text: "🔓", key: msg.key } });
            await updateOrSend(`✅ تم فك التشفير بنجاح!\n🔄 جاري الدخول...`);
            await delay(1000);
            await performLogin(updateOrSend, session.targetAccount);
            return;
        } else {
            await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
            const originalMsg = `\`🔐 يرجى ادخال كلمة السر لفك تشفير الحساب :\`\nاكتب *رجوع* للرجوع الى الصفحة السابقة.`;
            await updateOrSend("❌️ كلمة مرور غير صحيحة، حاول مجددا.");
            await delay(2000);
            await updateOrSend(originalMsg);
            return;
        }
    }

    if (session.state === 'DELETE_PASSWORD_CHECK') {
        if (cleanInput === 'رجوع') {
            await showAccountsList(updateOrSend);
            session.state = 'SELECT_ACCOUNT';
            userSessions.set(chatId, session);
            return;
        }

        if (input.toUpperCase() === session.targetPass) {
            await sock.sendMessage(chatId, { react: { text: "🔓", key: msg.key } });
            const res = accountUtils.deleteAccount(session.targetAccount);
            await updateOrSend(res.success ? `✅ تم حذف [ ${session.targetAccount} ].` : `❌ فشل الحذف: ${res.msg}`);
            await delay(2000);
            await showAccountsList(updateOrSend);
            session.state = 'SELECT_ACCOUNT';
            userSessions.set(chatId, session);
        } else {
            session.attempts++;
            await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
            if (session.attempts >= 3) {
                await updateOrSend("❌ تم رفض الوصول.");
                await delay(2000);
                await showAccountsList(updateOrSend);
                session.state = 'SELECT_ACCOUNT';
                userSessions.set(chatId, session);
            }
        }
        return;
    }

    if (session.state === 'PASSWORD_CHECK') {
        if (session.timeoutId) clearTimeout(session.timeoutId);
        if (cleanInput === 'رجوع') {
            await showAccountsList(updateOrSend);
            session.state = 'SELECT_ACCOUNT';
            return;
        }
        if (input.toUpperCase() === session.targetPass) {
            await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
            await performLogin(updateOrSend, session.targetAccount);
        } else {
            session.attempts++;
            await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
            if (session.attempts >= 3) {
                await updateOrSend("❌ تم رفض الوصول.");
                await delay(2000);
                await showAccountsList(updateOrSend);
                session.state = 'SELECT_ACCOUNT';
            } else {
                setupPasswordTimeout(chatId, session, sock, updateOrSend);
            }
        }
        return;
    }

    if (session.state === 'SETUP_MASTER') {
        const newName = input.replace(/\s/g, '_');
        if (newName.length < 3) {
            await sendTempError("❌ الاسم قصير جداً.", CREATE_ACC_PROMPT);
            return;
        }
        await updateOrSend("⏳ جاري إنشاء الحساب الرئيسي...");
        const result = accountUtils.createAccount(newName);
        if (result.success) {
            accountUtils.setMasterAccount(newName);
            await updateOrSend(`✅ تم تعيين [ ${newName} ] كحساب رئيسي.\n🔄 جاري الدخول...`);
            await delay(1000);
            await performLogin(updateOrSend, newName);
            userSessions.delete(chatId);
        } else {
            await sendTempError(`❌ خطأ: ${result.msg}`, CREATE_ACC_PROMPT);
        }
        return;
    }

    if (session.state === 'MAIN_MENU') {
        if (cleanInput === 'تفاصيل') {
            await updateOrSend(accountUtils.getWelcomeMessage() + "\n\n🔙 اكتب *رجوع* للعودة.");
            session.state = 'DETAILS_VIEW';
            userSessions.set(chatId, session);
            return;
        }
        if (cleanInput === 'بدء') {
            await showAccountsList(updateOrSend);
            session.state = 'SELECT_ACCOUNT';
            userSessions.set(chatId, session);
            return;
        }
    }

    if (session.state === 'DETAILS_VIEW') {
        if (cleanInput === 'رجوع') {
            session.state = 'MAIN_MENU';
            await updateOrSend("👋 اهلاً، يرجى كتابة *بدء* او *تفاصيل*");
            return;
        }
    }

    if (session.state === 'SELECT_ACCOUNT') {
        const masterAcc = accountUtils.getMasterAccountName();
        const allAccs = accountUtils.getAccountsList();
        const accounts = [masterAcc, ...allAccs.filter(a => a !== masterAcc)].filter(Boolean);

        if (cleanInput === 'انشاء حساب') {
            await updateOrSend(CREATE_ACC_PROMPT);
            session.state = 'CREATE_ACCOUNT_NAME';
            userSessions.set(chatId, session);
            return;
        }

        if (cleanInput.includes('حذف')) {
            const numStr = cleanInput.replace('حذف', '').trim();
            const index = parseInt(numStr) - 1;
            if (!isNaN(index) && accounts[index]) {
                const targetAccount = accounts[index];
                if (targetAccount === masterAcc) {
                    await sendTempError(`🚫 لا يمكنك حذف الحساب الرئيسي.`, await getAccountsListText());
                    return;
                }

                const savedPass = getTargetAccountPassword(masterAcc);
                if (savedPass) {
                    session.state = 'DELETE_PASSWORD_CHECK';
                    session.targetAccount = targetAccount;
                    session.targetPass = savedPass;
                    session.attempts = 0;
                    await sock.sendMessage(chatId, { react: { text: "🔐", key: msg.key } });
                    await updateOrSend(`\`🔐 يرجى ادخال كلمة السر لتأكيد الحذف :\`\nاكتب *رجوع* للإلغاء.`);
                    userSessions.set(chatId, session);
                    return;
                }
            }
        }

        const index = parseInt(cleanInput) - 1;
        if (!isNaN(index) && accounts[index]) {
            const targetAccount = accounts[index];

            if (targetAccount !== masterAcc) {
                if (accountUtils.isAccountLocked(targetAccount)) {
                    await updateOrSend(`\`🔐 يرجى ادخال كلمة السر لفك تشفير الحساب :\`\nاكتب *رجوع* للرجوع الى الصفحة السابقة.`);
                    session.state = 'DECRYPT_CHECK';
                    session.targetAccount = targetAccount;
                    userSessions.set(chatId, session);
                    return;
                }

                const savedPass = getTargetAccountPassword(targetAccount);
                if (savedPass) {
                    session.state = 'PASSWORD_CHECK';
                    session.targetAccount = targetAccount;
                    session.targetPass = savedPass;
                    session.attempts = 0;
                    await sock.sendMessage(chatId, { react: { text: "🔐", key: msg.key } });
                    setupPasswordTimeout(chatId, session, sock, updateOrSend);
                    userSessions.set(chatId, session);
                    return;
                }
            }

            await performLogin(updateOrSend, targetAccount);
            return;
        }
    }

    if (session.state === 'CREATE_ACCOUNT_NAME') {
        if (cleanInput === 'رجوع') {
            await showAccountsList(updateOrSend);
            session.state = 'SELECT_ACCOUNT';
            return;
        }
        const newName = input.replace(/\s/g, '_');
        if (newName.length < 3) {
            await sendTempError("❌ الاسم قصير جداً.", CREATE_ACC_PROMPT);
            return;
        }
       
        if (fs.existsSync(join(__dirname, newName))) {
            await sendTempError("❌ الاسم مستخدم بالفعل.", CREATE_ACC_PROMPT);
            return;
        }

        session.newAccountName = newName;
        await updateOrSend(CREATE_PASS_PROMPT);
        session.state = 'CREATE_ACCOUNT_PASS';
        userSessions.set(chatId, session);
        return;
    }

    if (session.state === 'CREATE_ACCOUNT_PASS') {
        if (cleanInput === 'رجوع') {
            await updateOrSend(CREATE_ACC_PROMPT);
            session.state = 'CREATE_ACCOUNT_NAME';
            return;
        }

        const pass = input.trim();
        
        if (!/^[a-zA-Z0-9]+$/.test(pass)) {
             await sendTempError("❌ كلمة المرور يجب أن تحتوي على أحرف إنجليزية وأرقام فقط.", CREATE_PASS_PROMPT);
             return;
        }
        if (pass.length < 4) {
             await sendTempError("❌ كلمة المرور قصيرة جداً.", CREATE_PASS_PROMPT);
             return;
        }

        await updateOrSend("⏳ جاري إنشاء الحساب وتجهيز التشفير...");
        const result = accountUtils.createAccount(session.newAccountName);

        if (result.success) {
            const accDir = join(__dirname, session.newAccountName);
            fs.writeFileSync(join(accDir, 'enc'), pass, 'utf8');

            await updateOrSend(`✅ تم إنشاء [ ${session.newAccountName} ]!\n🔄 جاري الدخول...`);
            await delay(1500);
            await performLogin(updateOrSend, session.newAccountName);
            userSessions.delete(chatId);
        } else {
            await sendTempError(`❌ خطأ: ${result.msg}`, CREATE_ACC_PROMPT);
            session.state = 'CREATE_ACCOUNT_NAME';
        }
        return;
    }
}

function setupPasswordTimeout(chatId, session, sock, updateOrSend) {
    if (session.timeoutId) clearTimeout(session.timeoutId);
    session.timeoutId = setTimeout(async () => {
        const currentSession = userSessions.get(chatId);
        if (currentSession && (currentSession.state === 'PASSWORD_CHECK' || currentSession.state === 'DECRYPT_CHECK' || currentSession.state === 'START_PASSWORD_CHECK')) {
            await sock.sendMessage(chatId, { react: { text: "🔒", key: session.botMsgKey } });
            if (currentSession.state === 'START_PASSWORD_CHECK') {
                userSessions.delete(chatId);
            } else {
                await updateOrSend("⏳ انتهت مهلة الإدخال.");
                await delay(1500);
                await showAccountsList(updateOrSend);
                currentSession.state = 'SELECT_ACCOUNT';
                userSessions.set(chatId, currentSession);
            }
        }
    }, 60000);
}

async function getAccountsListText() {
    const masterAcc = accountUtils.getMasterAccountName();
    const allAccs = accountUtils.getAccountsList();
    const list = [masterAcc, ...allAccs.filter(a => a !== masterAcc)].filter(Boolean);

    let menuText = "*👥 يرجى كتابة رقم احدى الحسابات للتسجيل :*\n______________________\n";
    if (list.length === 0) {
        menuText += "\n(لا توجد حسابات حالياً)\n";
    } else {
        list.forEach((acc, i) => {
            const isMaster = acc === masterAcc ? " (الرئيسي)" : "";
            const isLocked = accountUtils.isAccountLocked(acc) ? " 🔒" : "";
            menuText += `${i + 1}- ${acc}${isMaster}${isLocked}\n`;
        });
    }
    menuText += "______________________\n\n";
    menuText += "_اكتب الرقم للدخول، أو الرقم + *حذف* للحذف._\n";
    menuText += "`مثال : \"2 حذف\"`\n";
    menuText += "أو اكتب *انشاء حساب* لإنشاء حساب جديد.";
    return menuText;
}

async function showAccountsList(updateFn) {
    const text = await getAccountsListText();
    await updateFn(text);
}

async function performLogin(updateFn, accountName) {
    if (accountUtils.loginAccount(accountName)) {
        await updateFn(`\`✅ تم اختيار [ ${accountName} ]\``);
        process.send('reset');
    } else {
        await updateFn("❌ خطأ في النظام.");
    }
}
