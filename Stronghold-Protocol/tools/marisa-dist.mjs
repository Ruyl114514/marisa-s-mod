// 把「一键更新.bat」与「安装前请先读我.txt」从 mods/marisa-native/dist/ 复制进打包暂存目录。
// package-marisa.mjs 在打包末尾调用（见该文件底部的 copyDist()）。
// dist/ 下放什么，包里就多什么：想加一份「更新日志」之类的说明，丢进 dist/ 即可。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(REPO, 'mods/marisa-native/dist');
export function distFiles() {
  return fs.readdirSync(DIST).filter((name) => fs.statSync(path.join(DIST, name)).isFile()).sort();
}
export function copyDist(stage) {
  for (const name of distFiles()) fs.copyFileSync(path.join(DIST, name), path.join(stage, name));
  return distFiles();
}
