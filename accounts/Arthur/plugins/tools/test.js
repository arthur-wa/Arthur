import fs from "fs";
import path from "path";
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import { jidDecode } from "@whiskeysockets/baileys";


const NovaUltra = {
command: "تست",
  description: "اختبار رد بسيط",
  elite: "off",
  lock: "off",
  group: false,
  prv: false,
  nova: "on"
};


function decode(jid) {
  return (jidDecode(jid)?.user || jid.split("@")[0]) + "@s.whatsapp.net";
}

async function execute({sock, msg, args}) {
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
  
  
  const textMain = "`𝐴𝑇𝑅 𝐼𝑆 𝑊𝑂𝑅𝐾𝐼𝑁𝐺 𝑁𝑂𝑊`"; 

  try {

    await sock.sendMessage(chatId, {
      text: textMain,
      mentions: [sender]
    }, { quoted: msg }); 
  } catch (error) {
    console.error("Error in execute:", error);
    await sock.sendMessage(chatId, { text: "حدث خطأ." });
  }
}

export default { NovaUltra, execute };