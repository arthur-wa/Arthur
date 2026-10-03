import fs from "fs-extra";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import chalk from "chalk"; 

const colors = {
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m"
};

const logger = {
  info: (...args) => console.log(colors.blue, ...args, colors.reset),
  success: (...args) => console.log(colors.green, ...args, colors.reset),
  warn: (...args) => console.log(colors.yellow, ...args, colors.reset),
  error: (...args) => console.log(colors.red, ...args, colors.reset)
};

let loadedPlugins = {};
let pluginIssues = [];

export function getPluginIssues() {
  return pluginIssues;
}


async function getAllJsFiles(dir) {
  let results = [];
  
  if (!await fs.pathExists(dir)) return results;

  const list = await fs.readdir(dir, { withFileTypes: true });

  for (const item of list) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      const subFiles = await getAllJsFiles(fullPath);
      results = results.concat(subFiles);
    } else if (item.isFile() && item.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}



async function loadSinglePlugin(filePath, themeHex) {
  try {
    const fileUrl = pathToFileURL(filePath).href + `?update=${Date.now()}`;
    const module = await import(fileUrl);

    let handler = null;

    if (module.default && module.default.NovaUltra && typeof module.default.execute === "function") {
      handler = { ...module.default.NovaUltra, execute: module.default.execute };
    } else if (module.default && typeof module.default.execute === "function") {
      handler = module.default;
    } else if (module.NovaUltra && typeof module.execute === "function") {
      handler = { ...module.NovaUltra, execute: module.execute };
    } else if (typeof module.execute === "function") {
      handler = module;
    }

    if (!handler || !handler.execute) {
      logger.warn(`⚠ Skipped (no execute): ${filePath}`);
      pluginIssues.push(`❌ Skipped: ${filePath}`);
      return;
    }

    handler.filePath = filePath;

    let commands = handler.command;

    if (!commands) {
      const fileName = path.basename(filePath).replace(".js", "");
      commands = [fileName];
      logger.info(`ℹ '${fileName}' ⬇️  NAME FILE IS THE COMMAND HERE UNTIL YOU FIX IT`);
    } else if (typeof commands === "string") {
      commands = [commands];
    } else if (!Array.isArray(commands)) {
      logger.warn(`⚠ Invalid command format in ${filePath}`);
      pluginIssues.push(`❌ Invalid command format: ${filePath}`);
      return;
    }

    for (const cmd of commands) {
      if (typeof cmd !== "string") continue;

      const key = cmd.toLowerCase().trim();
      loadedPlugins[key] = handler;
      
      
      console.log(chalk.hex(themeHex)(`🛸 Plugin loaded: ${key}`));
    }

  } catch (err) {
    logger.error(`❌ Failed to load plugin (${filePath}):`, err);
    pluginIssues.push(`❌ Failed loading: ${filePath}\n${String(err)}`);
  }
}



export async function loadPlugins(themeColor) {
  loadedPlugins = {};
  pluginIssues = [];


  let hexColor = themeColor || '#00FF00';
  if (!hexColor.startsWith('#')) hexColor = '#' + hexColor;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pluginsDir = path.join(__dirname, "../plugins");

  await fs.ensureDir(pluginsDir);

  const files = await getAllJsFiles(pluginsDir);

  for (const file of files) {
    
    await loadSinglePlugin(file, hexColor);
  }

  
  console.log(chalk.hex(hexColor)("🔌 All plugins loaded successfully"));
  
  return loadedPlugins;
}

export function getPlugins() {
  return loadedPlugins;
}
