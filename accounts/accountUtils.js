import fs from 'fs-extra';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const accountsDir = __dirname;
const accFile = join(accountsDir, 'acc.txt');
// تم تعديل السطر التالي ليشير إلى داخل node_modules
const defaultTemplateDir = resolve(__dirname, '..', 'node_modules', 'default');
const welcomeFile = resolve(__dirname, '..', 'node_modules', 'axios', 'welcome.txt');


const SECRET_KEY = crypto.createHash('sha256').update('jnd_secure_session_v1').digest();


function encryptText(text) {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return iv.toString('base64') + ':' + encrypted;
    } catch (e) { return null; }
}

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


function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function(file) {
        if (fs.statSync(join(dirPath, file)).isDirectory()) {
            arrayOfFiles = getAllFiles(join(dirPath, file), arrayOfFiles);
        } else {
            arrayOfFiles.push(join(dirPath, file));
        }
    });
    return arrayOfFiles;
}


export function lockAccount(accountName) {
    const targetDir = join(accountsDir, accountName);
    const encFile = join(targetDir, 'enc');
    const lockedFile = join(targetDir, 'locked.dat');
    const mainFile = join(targetDir, 'main'); 
    if (fs.existsSync(mainFile)) return { success: false, msg: 'Main account cannot be locked.' };
    

    if (!fs.existsSync(encFile)) return { success: false, msg: 'No password set.' };
    if (fs.existsSync(lockedFile)) return { success: true, msg: 'Already locked.' };

    try {
        const password = fs.readFileSync(encFile, 'utf8').trim();
        const key = crypto.createHash('sha256').update(password).digest(); 
        const iv = crypto.randomBytes(16);

        
        const allFiles = getAllFiles(targetDir);
        const filesData = {};

        allFiles.forEach(filePath => {
            const relativePath = relative(targetDir, filePath);
            if (relativePath === 'enc' || relativePath === 'locked.dat' || relativePath === 'main') return;
            filesData[relativePath] = fs.readFileSync(filePath, 'base64');
        });


        const payload = JSON.stringify({ validation: 'ANASTASIA_SECURE', files: filesData });
        
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(payload, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        
        const finalData = iv.toString('base64') + ':' + encrypted;
        fs.writeFileSync(lockedFile, finalData, 'utf8');


        Object.keys(filesData).forEach(relPath => {
            fs.removeSync(join(targetDir, relPath));
        });
        

        fs.removeSync(encFile); 

        return { success: true };

    } catch (e) {
        console.error(`Lock failed for ${accountName}:`, e);
        return { success: false, msg: e.message };
    }
}


export function unlockAccount(accountName, passwordInput) {
    const targetDir = join(accountsDir, accountName);
    const lockedFile = join(targetDir, 'locked.dat');
    const encFile = join(targetDir, 'enc');

    if (!fs.existsSync(lockedFile)) return { success: true, msg: 'Not locked.' }; 

    try {
        const content = fs.readFileSync(lockedFile, 'utf8');
        const parts = content.split(':');
        if (parts.length !== 2) return { success: false, msg: 'Corrupt lock file.' };

        const iv = Buffer.from(parts[0], 'base64');
        const encryptedData = parts[1];
        const key = crypto.createHash('sha256').update(passwordInput).digest();

        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        const data = JSON.parse(decrypted);

        
        if (data.validation !== 'ANASTASIA_SECURE') {
            return { success: false, msg: 'Wrong Password' };
        }


        for (const [relPath, contentBase64] of Object.entries(data.files)) {
            const fullPath = join(targetDir, relPath);
            fs.ensureDirSync(dirname(fullPath));
            fs.writeFileSync(fullPath, contentBase64, 'base64');
        }

        
        fs.writeFileSync(encFile, passwordInput, 'utf8');
        
        
        fs.unlinkSync(lockedFile);

        return { success: true };

    } catch (e) {
        return { success: false, msg: 'Wrong Password or Corrupt Data' };
    }
}


export function lockAllAccounts() {
    const accounts = getAccountsList();
    accounts.forEach(acc => {

        const encPath = join(accountsDir, acc, 'enc');
        if (fs.existsSync(encPath)) {
            lockAccount(acc);
        }
    });
}

export function isAccountLocked(accountName) {
    return fs.existsSync(join(accountsDir, accountName, 'locked.dat'));
}

export function getWelcomeMessage() {
    fs.ensureDirSync(dirname(welcomeFile));
    if (!fs.existsSync(welcomeFile)) {
        const defaultMsg = `الاصدار الي معك مانه رسمي، شوف المصادر ذي :
        t.me/anastasiadjn
        anastasia.run`;
        fs.writeFileSync(welcomeFile, defaultMsg, 'utf8');
    }
    try {
        const content = fs.readFileSync(welcomeFile, 'utf8').trim();
        const isEncrypted = /^[A-Za-z0-9+/]{20,}={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(content);
        if (!isEncrypted) {
            const encrypted = encryptText(content);
            if (encrypted) fs.writeFileSync(welcomeFile, encrypted, 'utf8');
            return content; 
        } else {
            return decryptTextSafe(content) || "❌ Error: Decryption failed.";
        }
    } catch (e) { return "❌ Error reading welcome file."; }
}

export function getAccountsList() {
    if (!fs.existsSync(accountsDir)) return [];
    return fs.readdirSync(accountsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(n => n !== 'default' && n !== 'node_modules' && n !== '.git'); 
}

export function getMasterAccountName() {
    const accounts = getAccountsList();
    for (const account of accounts) {
        const magicFilePath = join(accountsDir, account, 'main');
        if (fs.existsSync(magicFilePath)) {
            try {

                const content = fs.readFileSync(magicFilePath, 'utf8').trim();
                if (content !== account) {

                    fs.unlinkSync(magicFilePath);
                    continue;
                }
                return account;
            } catch(e) {
                
                continue;
            }
        }
    }
    return null;
}

export function setMasterAccount(targetName) {
    try {
        const targetDir = join(accountsDir, targetName);
        if (!fs.existsSync(targetDir)) return false;

        const currentMaster = getMasterAccountName();
        if (currentMaster && currentMaster !== targetName) {
            const oldMagicFile = join(accountsDir, currentMaster, 'main');
            if (fs.existsSync(oldMagicFile)) fs.unlinkSync(oldMagicFile);
        }

        const newMagicFile = join(targetDir, 'main');
       
        fs.writeFileSync(newMagicFile, targetName, 'utf8'); 

        
        const encFile = join(targetDir, 'enc');
        const lockedFile = join(targetDir, 'locked.dat');
        if(fs.existsSync(encFile)) fs.unlinkSync(encFile);
        if(fs.existsSync(lockedFile)) fs.unlinkSync(lockedFile);

        return true;
    } catch (e) { return false; }
}

export function ensureAccountFiles(accountName) {
    const targetDir = join(accountsDir, accountName);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const checkFile = join(targetDir, 'nova'); 
    if (!fs.existsSync(checkFile)) {
        if (!fs.existsSync(defaultTemplateDir)) {
            console.error("❌ ERROR: Default template missing.");
            return false;
        }
        try {
            fs.copySync(defaultTemplateDir, targetDir, { overwrite: false });
            return true;
        } catch (e) { return false; }
    }
    return true;
}

export function createAccount(accountName) {
    const targetDir = join(accountsDir, accountName);
    if (!/^[a-zA-Z0-9_-]+$/.test(accountName)) return { success: false, msg: 'الاسم يحتوي على رموز غير مسموحة' };
    if (fs.existsSync(targetDir)) return { success: false, msg: 'الاسم مستخدم بالفعل' };
    
    const success = ensureAccountFiles(accountName);
    return success ? { success: true } : { success: false, msg: 'فشل نسخ الملفات' };
}

export function deleteAccount(accountName) {
    const magicFilePath = join(accountsDir, accountName, 'main');
    if (fs.existsSync(magicFilePath)) {
        return { success: false, msg: '⛔ لا يمكن حذف الحساب الرئيسي (يحتوي على ملف main)' };
    }
    const targetDir = join(accountsDir, accountName);
    if (!fs.existsSync(targetDir)) return { success: false, msg: 'الحساب غير موجود' };
    try {
        fs.removeSync(targetDir);
        return { success: true };
    } catch (e) { return { success: false, msg: e.message }; }
}

export function loginAccount(accountName) {
    const targetDir = join(accountsDir, accountName);
    if (!fs.existsSync(targetDir)) return false;
    

    if (isAccountLocked(accountName)) return false;

    try { fs.writeFileSync(accFile, `[${accountName}]`, 'utf8'); return true; } catch (e) { return false; }
}

export function logoutAccount() {
    try { 
        fs.writeFileSync(accFile, '[]', 'utf8'); 

        lockAllAccounts(); 
        return true; 
    } catch (e) { return false; }
}

export function getCurrentAccountName() {
    try {
        const content = fs.readFileSync(accFile, 'utf8').trim();
        const match = content.match(/\[(.*?)\]/);
        return match ? match[1] : null;
    } catch (e) { return null; }
}
