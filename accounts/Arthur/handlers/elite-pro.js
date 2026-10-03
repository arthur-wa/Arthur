import chalk from "chalk";
import { db } from "jsonion";

async function addElite({ sock, ids }) {
  const eliteDB = new db("handlers/elite-pro.json");
  let result = { fail: [], success: [] };
  if (!ids || !sock)
    return console.log(chalk.red("should input ids or add sock"));

  for (const id of ids) {
    const is = {
      lid: id.endsWith("@lid"),
      jid: id.endsWith("@s.whatsapp.net"),
    };

    switch (true) {
      case is.lid:
        const lids = eliteDB.get("lids");
        if (lids.includes(id)) {
          result.fail.push({
            id: id,
            type: "lid",
            error: "exist_already",
            success: false,
            action: "add",
          });
          continue;
        }
        eliteDB.pushToPath("lids", id);
        result.success.push({
          id: id,
          type: "lid",
          error: null,
          success: true,
          action: "add",
        });
        break;
      case is.jid:
        const jids = eliteDB.get("jids");
        if (jids.includes(id)) {
          result.fail.push({
            id: id,
            type: "jid",
            error: "exist_already",
            success: false,
            action: "add",
          });
          continue;
        }
        const [info] = await sock.onWhatsApp(id);
        if (!info) {
          result.fail.push({ id, type: "jid", error: "not_on_whatsapp", success: false, action: "add" });
          continue;
        }
        eliteDB.pushToPath("jids", id);
        if (info.lid && !eliteDB.get("lids").includes(info.lid)) eliteDB.pushToPath("lids", info.lid);
        const twice = eliteDB.get("twice");
        eliteDB.set("twice", {
          ...twice,
          [info.lid]: info.jid,
          [info.jid]: info.lid,
        });
        result.success.push({
          id: id,
          type: "jid",
          error: null,
          success: true,
          action: "add",
        });
        break;
      default:
        continue;
    }
  }
  return result;
}

async function rmElite({ sock, ids }) {
  const eliteDB = new db("handlers/elite-pro.json");
  let result = { fail: [], success: [] };
  if (!ids || !sock)
    return console.log(chalk.red("should input ids or add sock"));

  for (const id of ids) {
    const is = {
      lid: id.endsWith("@lid"),
      jid: id.endsWith("@s.whatsapp.net"),
    };

    switch (true) {
      case is.lid:
        const lids = eliteDB.get("lids");
        if (!lids.includes(id)) {
          result.fail.push({
            id: id,
            type: "lid",
            error: "not_exist",
            success: false,
            action: "remove",
          });
          continue;
        }
        const twice1 = eliteDB.get("twice");
        const jids1 = eliteDB.get("jids");
        eliteDB.set(
          "lids",
          lids.filter((l) => l !== id)
        );
        if (twice1[id]) {
          eliteDB.set(
            "jids",
            jids1.filter((j) => j !== twice1[id])
          );
          delete twice1[twice1[id]];
          delete twice1[id];
          eliteDB.set("twice", twice1);
        }

        result.success.push({
          id: id,
          type: "lid",
          error: null,
          success: true,
          action: "remove",
        });

        break;

      case is.jid:
        const [info] = await sock.onWhatsApp(id);
        const jids = eliteDB.get("jids");
        const lids1 = eliteDB.get("lids");
        const twice = eliteDB.get("twice");
        if (!jids.includes(id) && (!info || !lids1.includes(info.lid))) {
          result.fail.push({
            id: id,
            type: "jid",
            error: "not_exist",
            success: false,
            action: "remove",
          });
          continue;
        }
        if (jids.includes(id))
          eliteDB.set(
            "jids",
            jids.filter((j) => j !== id)
          );
        if (lids1.includes(info.lid))
          eliteDB.set(
            "lids",
            lids1.filter((l) => l !== info.lid)
          );

        if (twice[id]) delete twice[id];
        if (twice[info.lid]) delete twice[info.lid];
        console.log("twicen", twice);

        eliteDB.set("twice", twice);
        result.success.push({
          id: id,
          type: "jid",
          error: null,
          success: true,
          action: "remove",
        });
        break;
      default:
        continue;
    }
  }
  return result;
}

async function isElite({ sock, id }) {
  const eliteDB = new db("handlers/elite-pro.json");
  const is = {
    lid: id.endsWith("@lid"),
    jid: id.endsWith("@s.whatsapp.net"),
  };

  const jids = eliteDB.get("jids");
  const lids = eliteDB.get("lids");
  const twice = eliteDB.get("twice");
  if (is.jid) {
    const [info] = await sock.onWhatsApp(id);
    if (jids.includes(id)) return true;
    if (info && info.lid && lids.includes(info.lid)) {
      eliteDB.pushToPath("jids", id);
      eliteDB.set("twice", {
        ...twice,
        [info.jid]: info.lid,
        [info.lid]: info.jid,
      });
      return true;
    }
  }
  if (is.lid) {
    return lids.includes(id);
  }
  return false;
}

function getElites() {
  const eliteDB = new db("handlers/elite-pro.json");
  const lids = eliteDB.get("lids");
  return lids.length > 0 ? lids : null;
}


async function eliteReset({ sock } = {}) {

  if (!sock) {
    console.log(chalk.red("❌ Error: sock is required for smart eliteReset"));

    const eliteDB = new db("handlers/elite-pro.json");
    eliteDB.set("lids", []);
    eliteDB.set("jids", []);
    eliteDB.set("twice", {});
    return true;
  }

  const eliteDB = new db("handlers/elite-pro.json");
  

  const botJid = sock.user.id.split(':')[0] + "@s.whatsapp.net";
  

  const jids = eliteDB.get("jids") || [];
  const twice = eliteDB.get("twice") || {};


  const isBotInJids = jids.includes(botJid);

  if (isBotInJids) {
    
    console.log(chalk.green(`Elite Reset: Keeping Bot (${botJid}) in Elite.`));
    
    const botLid = twice[botJid];

    eliteDB.set("jids", [botJid]);
    
    if (botLid) {
        eliteDB.set("lids", [botLid]);
        eliteDB.set("twice", {
            [botJid]: botLid,
            [botLid]: botJid
        });
    } else {
        eliteDB.set("lids", []);
        eliteDB.set("twice", {});
    }

  } else {

    console.log(chalk.yellow(`Elite Reset: Bot not found, clearing all.`));
    eliteDB.set("lids", []);
    eliteDB.set("jids", []);
    eliteDB.set("twice", {});
  }
  
  return true;
}

const elitePro = { addElite, rmElite, isElite, getElites, eliteReset };
export default elitePro;
