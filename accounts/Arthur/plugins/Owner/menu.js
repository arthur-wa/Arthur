import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jidDecode } from "@whiskeysockets/baileys";
import { getPlugins } from "../../handlers/plugins.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activeMenuSessions = new Map();

const NovaUltra = {
command: "اوامر", 
  description: "قائمة الأوامر التفاعلية — Ultra Nova",
  elite: "off",
  lock: "off",
  nova: "on"
};

function decode(jid) {
  return (jidDecode(jid)?.user || jid.split("@")[0]) + "@s.whatsapp.net";
}

function getCommandStatusSuffix(plugin) {
  let suffix = "";
  const isElite = plugin.elite === "on";
  const isLocked = plugin.lock === "on";
  
  const adminKeywords = [
    "طرد", "حظر", "رفع", "خفض", "تغيير", "قفل", "فتح", 
    "kick", "ban", "promote", "demote", "admin", "group", "tagall", "hidetag"
  ];

  const cmdArray = Array.isArray(plugin.command) ? plugin.command : [plugin.command];
  
  const textToCheck = ((plugin.description || "") + " " + cmdArray.join(" ")).toLowerCase();
  const isAdminRelated = adminKeywords.some(k => textToCheck.includes(k)) || plugin.admin === true || plugin.group === true;

  if (isLocked) suffix += " 🔒";
  if (isElite) suffix += " 🔰";
  if (!isLocked && !isElite && isAdminRelated) {
    suffix += " ⚠️";
  }

  return suffix; 
}

async function execute({ sock, msg, args }) {
    // NOVA_INJECTION_START
    const _nova_origSend = sock.sendMessage;
    sock.sendMessage = async (jid, content, options = {}) => {
        if (typeof NovaUltra !== 'undefined' && NovaUltra.nova === 'on') {
            const _textBody = content.text || content.caption;
            
            if (_textBody && typeof _textBody === 'string') {
                
                let _nD = { ceiling: "𝐴𝑁𝐴𝑆𝑇𝐴𝑆𝐼𝐴", name: "𝐀𝐧𝐚𝐬𝐭𝐚𝐬𝐢𝐚 𝐯𝟒", description: "𝚄𝙻𝚃𝚁𝙰 𝙽𝙾𝚅𝙰 𝚅𝙴𝚁", verification: true, media: true };
                try {
                    const _cfgPath = path.join(process.cwd(), "nova", "config.js");
                    const _cfgContent = fs.readFileSync(_cfgPath, "utf8");
                    const _match = _cfgContent.match(/novaInfo:\s*({[\s\S]*?})(,|$)/);
                    if (_match) {
                        const _loaded = new Function("return " + _match[1])();
                        _nD = { ..._nD, ..._loaded };
                    }
                } catch(e) {}

                
                let _nTh = null;
                const _isMediaActive = (_nD.media !== false); 
                if (_isMediaActive) {
                    try {
                        const _img = path.join(process.cwd(), "nova", "image.jpeg");
                        if (fs.existsSync(_img)) _nTh = fs.readFileSync(_img);
                    } catch(e) {}
                }

                let _finalQuoted = options.quoted || msg;
                if (_nD.verification === true) {
                    _finalQuoted = {
                        key: { fromMe: false, participant: "0@s.whatsapp.net", remoteJid: "0@s.whatsapp.net" },
                        message: { conversation: _nD.ceiling || "" }
                    };
                }

                
                
                const _contextInfo = {
                    mentionedJid: options.mentions || [],
                    stanzaId: "NOVA_" + Date.now(),
                    ...(_nD.verification ? { participant: "0@s.whatsapp.net" } : {}),
                    quotedMessage: _finalQuoted.message,
                    externalAdReply: (_isMediaActive) ? {
                        title: _nD.name, 
                        body: _nD.description, 
                        mediaType: 1, 
                        renderLargerThumbnail: true, 
                        showAdAttribution: true, 
                        ...(_nTh ? { thumbnail: _nTh } : {})
                    } : null
                };

                const _nM = generateWAMessageFromContent(jid, {
                    extendedTextMessage: {
                        text: _textBody,
                        contextInfo: _contextInfo
                    }
                }, { 
                    userJid: sock.user?.id, 
                    quoted: _finalQuoted,
                    
                    linkPreview: _isMediaActive ? undefined : null 
                });

                return await sock.relayMessage(jid, _nM.message, { messageId: _nM.key.id });
            }
        }
        return await _nova_origSend.call(sock, jid, content, options);
    };
    // NOVA_INJECTION_END
    
  

  const chatId = msg.key.remoteJid;
  const sender = decode(msg.key.participant || chatId);

  if (activeMenuSessions.has(chatId)) {
      const oldSession = activeMenuSessions.get(chatId);
      sock.ev.off("messages.upsert", oldSession.listener);
      clearTimeout(oldSession.timer);
      activeMenuSessions.delete(chatId);
  }

  try {
    const pluginsRoot = path.join(process.cwd(), "plugins");
    const categories = fs
      .readdirSync(pluginsRoot)
      .filter((dir) => fs.statSync(path.join(pluginsRoot, dir)).isDirectory());

    const getMainMenuText = () => {
      
      const allPlugins = getPlugins();
      let totalCmds = 0;
      let eliteCmds = 0;
      let lockedCmds = 0;
      let unsafeCmds = 0;

      const adminKeywords = [
        "طرد", "حظر", "رفع", "خفض", "تغيير", "قفل", "فتح", 
        "kick", "ban", "promote", "demote", "admin", "group", "tagall", "hidetag"
      ];

      for (const plugin of Object.values(allPlugins)) {
        if (!plugin || plugin.hidden) continue;
        
        
        totalCmds++;

        
        const isElite = plugin.elite === "on";
        const isLocked = plugin.lock === "on";

        if (isElite) eliteCmds++;
        if (isLocked) lockedCmds++;

        
        const cmdArray = Array.isArray(plugin.command) ? plugin.command : [plugin.command];
        const textToCheck = ((plugin.description || "") + " " + cmdArray.join(" ")).toLowerCase();
        const isAdminRelated = adminKeywords.some(k => textToCheck.includes(k)) || plugin.admin === true || plugin.group === true;

        if (!isLocked && !isElite && isAdminRelated) {
            unsafeCmds++;
        }
      }

      let menu = `
✧━── ❝ 𝐔𝐥𝐭𝐫𝐚 𝐍𝐨𝐯𝐚 ❞ ──━✧

🌌⌁ ⚡ *الفئات المتوفّرة* ⚡ ⌁🌌
`;
      for (const c of categories) {
        menu += `\n✦◞ 🪐 *${c}* ◟✦`;
      }
      menu += `
      
 *✅️ اجمالي عدد الاوامر الحالية:* ${totalCmds}
*🛡عدد اوامر النخبة :* ${eliteCmds}
*🔐 عدد الاوامر المقفلة :* ${lockedCmds}
*⚠️عدد اوامر الغير آمنة :* ${unsafeCmds}
\n✍️ *اكتب اسم الفئة لعرض أوامرها.*
⚠️ \`لم تجد امر معين رغم اضافتك له؟\`
\`حدث البلوجينات ب امر "حدث"\`
\`او افحص الكونسل او اكتب امر "مشاكل" لرؤية الاخطاء\`

✧━── *❝𝙰𝚁𝚃𝙷𝚄𝚁❞──━✧
`;
      return menu;
    };

    const initialText = getMainMenuText();
    
    const sentMsg = await sock.sendMessage(chatId, { text: initialText }, { quoted: msg });
    const botMsgKey = sentMsg.key;

    let state = "MAIN"; 
    let sessionTimer; 

    const updateMessage = async (newText) => {
      await sock.sendMessage(chatId, { text: newText, edit: botMsgKey });
    };

    const listener = async ({ messages }) => {
      const newMsg = messages[0];
      if (!newMsg.message || newMsg.key.remoteJid !== chatId) return;
      
      const newSender = decode(newMsg.key.participant || newMsg.key.remoteJid);
      if (newSender !== sender) return; 

      const text = newMsg.message?.conversation || newMsg.message?.extendedTextMessage?.text || "";
      if (!text) return;
      const input = text.trim(); 

      if (input === "رجوع") {
        if (state === "CATEGORY_VIEW") {
          await sock.sendMessage(chatId, { react: { text: "🔙", key: newMsg.key } });
          await updateMessage(getMainMenuText());
          state = "MAIN";
          resetTimer();
        }
        return;
      }

      if (state === "MAIN") {
        const selectedCategory = categories.find(c => c.toLowerCase() === input.toLowerCase());

        if (selectedCategory) {
          await sock.sendMessage(chatId, { react: { text: "🆗", key: newMsg.key } });

          const plugins = getPlugins();
          const commandsList = [];

          for (const plugin of Object.values(plugins)) {
            if (!plugin || plugin.hidden) continue;
            
            const pluginPath = plugin.filePath || "";
            if (pluginPath.includes(`/plugins/${selectedCategory}/`)) {
              const cmds = Array.isArray(plugin.command) ? plugin.command : [plugin.command];
              const suffix = getCommandStatusSuffix(plugin);
              const line = `✦ \`${cmds[0]}\`${suffix}` + (plugin.description ? `\n   ╰ ${plugin.description}` : "");
              commandsList.push(line);
            }
          }

          let categoryMenu = `
✧━── ❝ 𝐔𝐥𝐭𝐫𝐚 𝐍𝐨𝐯𝐚 ❞ ──━✧

📂 *الفئة:* ${selectedCategory}

`;
          if (commandsList.length === 0) {
            categoryMenu += `❗ لا توجد أوامر ظاهرة في هذه الفئة.\n`;
          } else {
            categoryMenu += commandsList.join("\n\n");
          }

          categoryMenu += `

↩️ *اكتب "رجوع" للعودة لقائمة الفئات.*

✧━── ❝ 𝐀𝐧𝐚𝐬𝐭𝐚𝐬𝐢𝐚 𝐯𝟒 ❞ ──━✧`;

          await updateMessage(categoryMenu);
          state = "CATEGORY_VIEW";
          resetTimer();
        } 
      }
    };

    const resetTimer = () => {
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = setTimeout(() => {
        sock.ev.off("messages.upsert", listener);
        activeMenuSessions.delete(chatId);
      }, 3 * 60 * 1000); 

      activeMenuSessions.set(chatId, { listener, timer: sessionTimer });
    };

    resetTimer();
    sock.ev.on("messages.upsert", listener);

  } catch (err) {
    console.error("Menu Error:", err);
    await sock.sendMessage(chatId, { text: "❌ حدث خطأ أثناء إنشاء القائمة." });
  }
}

export default { NovaUltra, execute };
