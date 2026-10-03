const usageMessage = 
      "❌ أمر غير معروف.\n\n" +
      "الأوامر المتاحة:\n" +
      "• .نخبة اضف [منشن/رد/رقم]\n" +
      "• .نخبة ازل [منشن/رد/رقم]\n" +
      "• .نخبة عرض\n" +
      "• .نخبة ضبط";

const NovaUltra = {
  command: "نخبة",
  description: "إدارة النخبة",
  usage: ".نخبة [اضف | ازل | عرض] [منشن | رد | رقم]",
  elite: "on",
  group: false,
  prv: false,
  lock: "on",
};

async function execute({ sock, msg, args, BIDS, sender }) {
    const action = args[0];
    
    let ids = (await sock.replyedJid(msg)) || (await sock.mentionnedJids(msg));

    if ((!ids || ids.length === 0) && args[1]) {
        
        const number = args[1].replace(/[^0-9]/g, '');
        
        if (number.length > 5) {
            const tempJid = number + "@s.whatsapp.net";
            
            const check = await sock.onWhatsApp(tempJid);
            
            if (check && check[0]?.exists) {
                ids = [check[0].jid];
            } else {
                return sock.sendMessage(
                    msg.key.remoteJid,
                    { text: "❌ هذا الرقم غير مسجل في واتساب." },
                    { quoted: msg }
                );
            }
        }
    }

    // تنظيف المعرفات (JIDs) وإزالة الأجهزة الفرعية لضمان التطابق التام وتجنب المشاكل
    if (ids) {
        if (!Array.isArray(ids)) ids = [ids];
        ids = ids.map(id => {
            if (!id || typeof id !== 'string') return null;
            return id.split("@")[0].split(":")[0] + "@s.whatsapp.net";
        }).filter(Boolean);
    }

    if (!action) {
      return sock.sendMessage(
        msg.key.remoteJid,
        { text: usageMessage },
        { quoted: msg }
      );
    }

    switch (action) {
      case "اضف": {
        if (!ids || ids.length === 0) {
            return sock.sendMessage(msg.key.remoteJid, { text: "يرجى عمل منشن، رد، أو كتابة الرقم بجانب الأمر." }, { quoted: msg });
        }
        const res_add = await sock.addElite({ sock, ids });
        let mess_add = "*إضافة أعضاء النخبة*\n\n";
        let mentions = [];

        if (res_add.success && res_add.success.length > 0) {
          mess_add += "✅ *تمت الإضافة بنجاح:*\n";
          for (const user of res_add.success) {
            const uid = user?.id || (typeof user === 'string' ? user : null);
            if (!uid) continue;
            mess_add += `> @${uid.split("@")[0]}\n`;
            mentions.push(uid);
          }
        }
        
        if (res_add.fail && res_add.fail.length > 0) {
          if (res_add.success.length > 0) mess_add += "\n"; 
          mess_add += "⚠️ *تنبيه:*\n";
          for (const user of res_add.fail) {
            const uid = user?.id || (typeof user === 'string' ? user : null);
            if (!uid) continue;
            if (user.error === "exist_already") {
                mess_add += `• العضو @${uid.split("@")[0]} هو نخبة بالفعل.\n`;
            } else {
                mess_add += `• فشل @${uid.split("@")[0]}: ${user.error || "غير معروف"}\n`;
            }
            mentions.push(uid);
          }
        }

        return sock.sendMessage(msg.key.remoteJid, {
          text: mess_add.trim(),
          mentions,
        });
      }

      case "ازل": {
        if (!ids || ids.length === 0) {
            return sock.sendMessage(msg.key.remoteJid, { text: "يرجى عمل منشن، رد، أو كتابة الرقم بجانب الأمر." }, { quoted: msg });
        }
        const res_rm = await sock.rmElite({ sock, ids });
        let mess_rm = "*إزالة أعضاء النخبة*\n\n";
        let mentions = [];

        if (res_rm.success && res_rm.success.length > 0) {
          mess_rm += "✅ *تمت الإزالة بنجاح:*\n";
          for (const user of res_rm.success) {
            const uid = user?.id || (typeof user === 'string' ? user : null);
            if (!uid) continue;
            mess_rm += `> @${uid.split("@")[0]}\n`;
            mentions.push(uid);
          }
        }
        
        if (res_rm.fail && res_rm.fail.length > 0) {
          if (res_rm.success.length > 0) mess_rm += "\n";
          mess_rm += "⚠️ *تنبيه:*\n";
          for (const user of res_rm.fail) {
             const uid = user?.id || (typeof user === 'string' ? user : null);
             if (!uid) continue;
             if (user.error === "not_exist") {
                mess_rm += `• العضو @${uid.split("@")[0]} ليس من النخبة أصلاً.\n`;
             } else {
                mess_rm += `• فشل @${uid.split("@")[0]}: ${user.error || "غير معروف"}\n`;
             }
            mentions.push(uid);
          }
        }

        return sock.sendMessage(msg.key.remoteJid, {
          text: mess_rm.trim(),
          mentions,
        });
      }

      case "عرض": {
        const elites = sock.getElites(); 
        if (!elites || elites.length === 0) {
          return sock.sendMessage(
            msg.key.remoteJid,
            { text: "لا يوجد أعضاء نخبة حالياً." },
            { quoted: msg }
          );
        }
        let text = "👑 *أعضاء النخبة:*\n\n";
        let mentions = [];
        for (const id of elites) {
          if (!id || typeof id !== 'string') continue;
          text += `• @${id.split("@")[0]}\n`;
          mentions.push(id);
        }
        if (mentions.length === 0) {
          return sock.sendMessage(
            msg.key.remoteJid,
            { text: "لا يوجد أعضاء نخبة حالياً." },
            { quoted: msg }
          );
        }
        return sock.sendMessage(
          msg.key.remoteJid,
          { text: text.trim(), mentions },
          { quoted: msg }
        );
      }

      case "ضبط": {
        await sock.eliteReset({ sock });
        return sock.sendMessage(
          msg.key.remoteJid,
          { text: "✅ تم تصفير قائمة النخبة بنجاح." },
          { quoted: msg }
        );
      }

      default: {
        return sock.sendMessage(
          msg.key.remoteJid,
          { text: usageMessage },
          { quoted: msg }
        );
      }
    }
}

export default { NovaUltra, execute };
