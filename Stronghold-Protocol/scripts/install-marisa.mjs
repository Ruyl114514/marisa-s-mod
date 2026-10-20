// Install the MOD bundle on a fresh source checkout. Keep local edits and room policy.
//
// 玩家拿到的完整包里，MOD 插件本体已经放在 plugins/marisa，所以这个脚本在包里是空跑（幂等）；
// 它真正干活是在源码仓库里：从 mods/marisa-native/bundle/marisa 把插件装到 plugins/ 下。
// 完整包不带 mods/ 源码，所以插件本体必须直接进包 —— 见 tools/package-marisa.mjs。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const plugins = path.join(root, 'plugins');
const installed = path.join(plugins, 'marisa');
const bundle = path.join(root, 'mods/marisa-native/bundle/marisa');
if (!fs.existsSync(installed) && fs.existsSync(bundle)) {
  fs.cpSync(bundle, installed, { recursive: true });
  console.log('已安装魔理沙追加 MOD 0.3.1。');
}
const policy = path.join(plugins, 'config.json');
if (!fs.existsSync(policy)) {
  fs.writeFileSync(policy, JSON.stringify({ rooms: 'host', default: ['marisa'] }, null, 2) + '\n');
  console.log('新房间默认启用魔理沙追加 MOD，可在房间插件管理器中调整。');
}
