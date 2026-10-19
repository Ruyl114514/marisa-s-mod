// Import the author's published files as build inputs. The host engine is never overwritten.
// Usage: node mods/marisa-native/import-author.mjs <unpacked-full-release> <unpacked-replacement>
import fs from 'node:fs';
import path from 'node:path';

const [release, replacement] = process.argv.slice(2).map(file => path.resolve(file));
const source = path.join(import.meta.dirname, 'source');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const authorFile = relative => {
  const patch = path.join(replacement, relative);
  return fs.existsSync(patch) ? patch : path.join(release, relative);
};
const copyInput = (relative, target = relative) => {
  const destination = path.join(source, target);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.copyFileSync(authorFile(relative), destination);
};

// The release omits its generator. Keep the supplied tables as immutable input snapshots,
// just as the previous adapter did; build-profile.mjs derives the installed plugin from them.
for (const table of ['chess', 'bonds', 'bands', 'items', 'garrisons', 'effects', 'tokens', 'backups']) {
  copyInput(`data/${table}.json`, `data/mods/marisa/${table}.json`);
}
copyInput('data/assets.json');
copyInput('data/skins.json', 'data/author-skins.json');
for (const language of ['en', 'ja', 'ko', 'zh-TW']) copyInput(`data/i18n/${language}.json`);

for (const name of ['makoto', 'amiya3', 'aglna2', 'kalts2', 'headbr', 'headb2', 'helage', 'kormr', 'aigis', 'yukari']) {
  // Preserve the existing adapter's separate names for its two official-operator variants.
  const target = ['aglna2', 'kalts2'].includes(name) ? `mod-${name}` : `op-${name}`;
  copyInput(`server/sim/content/kits/ops/op-${name}.js`, `server/sim/content/kits/ops/${target}.js`);
}
for (const relative of [
  'server/sim/content/kits/shared/mod-tier3.js',
  'server/sim/content/bonds/addon/battle.js',
  'server/sim/content/bonds/addon/rhode.js',
  'server/sim/content/bonds/addon/sees.js',
  'server/sim/content/bonds/addon/unite.js',
  'server/sim/content/bonds/addon/unite-meta.js',
  'server/sim/content/garrisons/battle.js',
  'server/sim/content/bands/battle.js',
]) copyInput(relative);

// Keep official 0.3.1 audio roles intact and add the author's extra roles and their pools.
const stock = readJson(path.join(import.meta.dirname, 'base-assets.json')).audio.sfx;
const audio = readJson(authorFile('data/assets.json')).audio.sfx;
const units = Object.fromEntries(Object.entries(audio.units).filter(([id]) => !stock.units[id]));
const pools = Object.fromEntries(Object.entries(audio.pools ?? {}).filter(([id]) => !stock.pools[id]));
fs.writeFileSync(path.join(import.meta.dirname, 'extra-audio-author.json'), JSON.stringify({units, pools}, null, 2) + '\n');
console.log('Imported author gameplay, art references, translations and audio inputs.');
