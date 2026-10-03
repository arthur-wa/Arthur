import { exec } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const soundsDir = path.join(__dirname, '..', 'nova', 'sounds');

export const SOUND = {
  LOGOUT: path.join(soundsDir, 'LOGGOUT.mp3'),
  ERROR: path.join(soundsDir, 'ERROR.mp3'),
  OK: path.join(soundsDir, 'OK.mp3'),
};

export function play(file) {
  try {
    if (fs.existsSync(file)) {
      exec(`mpv --no-terminal --really-quiet "${file}"`);
    }
  } catch {}
}

export function playError() {
  play(SOUND.ERROR);
}

export function playLogout() {
  play(SOUND.LOGOUT);
}

export function playOK() {
  play(SOUND.OK);
}