// Build the native Marisa profile from published snapshots. The host's tables stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {addMissingDiyBodies} from './build-diy.mjs';

export const legacy = path.join(import.meta.dirname, 'source');
export const game = path.resolve(import.meta.dirname, '../..');
export const plugin = path.join(game, 'plugins/marisa');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const tableNames = ['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'config', 'backups'];
const base = Object.fromEntries(tableNames.map(name => [name, readJson(path.join(game, 'data', `${name}.json`))]));
const full = Object.fromEntries(tableNames.map(name => [name, readJson(path.join(legacy, 'data/mods/marisa', `${name}.json`))]));
addMissingDiyBodies(full, base);

// These snapshots already contain the author's 0.3.1 changes. The remaining archived
// tables still need the official 0.3.0 -> 0.3.1 delta, provided as an offline build input.
const updatedTables = new Set(['chess', 'backups', 'tokens', 'bonds', 'garrisons', 'items', 'bands', 'effects']);
const upstream = readJson(path.join(import.meta.dirname, 'upstream-0.3.1.json'));
for (const change of upstream.changes.filter(change => !updatedTables.has(change.file))) {
  let parent = full[change.file];
  for (const key of change.path.slice(0, -1)) parent = parent?.[key];
  if (!parent || typeof parent !== 'object') continue;
  const key = change.path.at(-1);
  if (Object.hasOwn(parent, key) !== Object.hasOwn(change, 'before')) continue;
  if (JSON.stringify(parent[key]) !== JSON.stringify(change.before)) continue;
  if (Object.hasOwn(change, 'after')) parent[key] = structuredClone(change.after);
  else delete parent[key];
}

const prefixes = {chess: 'chess_x', bonds: 'bond_x', garrisons: 'garrison_x', bands: 'band_x', effects: 'effect_x', tokens: 'token_x', items: 'item_x'};
export const aliases = {};
for (const [table, prefix] of Object.entries(prefixes)) {
  for (const id of Object.keys(full[table])) {
    if (Object.hasOwn(base[table], id)) continue;
    const suffix = id.replace(/^(chess_char_\d+_|chess_item_|garrison_|token_|aceffect_|bondeffect_|band_)/, '');
    aliases[id] = `${prefix}_marisa_${suffix}`;
    if (table === 'chess') aliases[id.replace(/_[ab]$/, '')] = aliases[id].replace(/_[ab]$/, '');
  }
}
for (const id of Object.keys(full.backups.units)) {
  if (!base.backups.units[id]) aliases[id] = `char_x_marisa_${id.replace(/^char_\d+_/, '')}`;
}
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliasPattern = new RegExp(`(?<![A-Za-z0-9_])(${Object.keys(aliases).sort((a, b) => b.length - a.length).map(escapePattern).join('|')})(?![A-Za-z0-9_])`, 'g');
export const rename = source => source.replace(aliasPattern, id => aliases[id]);
const extended = JSON.parse(rename(JSON.stringify(full)));

// The host caps unfamiliar blackboard values. Store large thresholds in hundreds;
// build-runtime restores their original units at the exact readers that use them.
for (const table of [extended.bonds, extended.effects, extended.garrisons]) {
  for (const record of Object.values(table)) {
    for (const blackboard of [record.bb, ...(record.buffs ?? []).map(buff => buff.bb)]) {
      if (!blackboard) continue;
      for (const key of ['aura_l_max', 'shinko_gauge_max', 'max_attack_speed']) {
        if (blackboard[key]) blackboard[key] /= 100;
      }
    }
  }
}
for (const [id, record] of Object.entries(extended.garrisons)) {
  if (!id.startsWith('garrison_x_marisa_') || record.eventType !== 'IN_BATTLE') continue;
  record.scriptHandler = true;
  // The SDK dispatches the author's exact handler from bbStr.key. The event family
  // remains one the host knows, without changing its validator or supported limits.
  if (['act1autochess_gar_event_statusctrl', 'act1autochess_gar_eff_alloutBonus'].includes(record.effectKey)) {
    record.bbStr = {...record.bbStr, key: record.effectKey};
    record.effectKey = 'act1autochess_gar_event_selfdead';
  }
}
for (const [id, record] of Object.entries(extended.effects)) {
  if (id.startsWith('effect_x_marisa_')) record.scriptHandler = 'marisa';
}
const tables = Object.fromEntries(tableNames.filter(name => JSON.stringify(base[name]) !== JSON.stringify(extended[name]))
  .map(name => [name, extended[name]]));
fs.mkdirSync(path.join(plugin, 'data'), {recursive: true});
fs.writeFileSync(path.join(plugin, 'data/profile.json'), JSON.stringify({profile: 1, kind: 'marisa', tables}));
fs.writeFileSync(path.join(import.meta.dirname, 'aliases.json'), JSON.stringify(aliases, null, 2) + '\n');

// Settings remain an ordinary editable module. Remove only its import when combining
// the two sources into the existing shared profile used by browser and server.
const profileSource = fs.readFileSync(path.join(legacy, 'shared/mods.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(legacy, 'shared/native-settings.js'), 'utf8')
  .replace(/import \{[\s\S]*?\} from '\.\/mods.js';/, '');
const profile = '// i18n-ignore-file: generated plugin metadata supplies its own localized labels.\n'
  + rename(profileSource + '\n' + settingsSource);
fs.writeFileSync(path.join(game, 'shared/plugins/marisaProfile.js'), profile);
const {MARISA_SETTINGS} = await import(pathToFileURL(path.join(game, 'shared/plugins/marisaProfile.js')).href);
if (Object.keys(MARISA_SETTINGS).length > 32) throw new Error('Marisa exceeds the native 32-setting limit');
const manifest = {
  '$schema': '../../schemas/plugin.schema.json', manifest: 2, id: 'marisa', name: '魔理沙追加 MOD',
  version: '0.3.1', app: '>=0.3.1 <0.4.0', api: 1, class: 'script', scope: ['room'],
  authors: ['Marisa-la', 'Ruyl114514'],
  description: {
    zh: '十位干员、罗德岛、S.E.E.S、我们联合、两种策略与人格羁绊；原生插件管理器逐项配置。需要配套的 0.3.1 兼容补丁。',
    en: 'Ten operators, three alliances, two strategies and Persona Bond. Requires the 0.3.1 compatibility patch.',
  },
  permissions: ['data.add', 'data.patch', 'sim.code', 'meta.code'], budget: 1000000,
  data: ['data/profile.json'], settings: MARISA_SETTINGS, entry: {sim: 'sim/index.js', meta: 'sim/index.js'},
};
fs.writeFileSync(path.join(plugin, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Native profile: ${Object.keys(MARISA_SETTINGS).length} settings; ${fs.statSync(path.join(plugin, 'data/profile.json')).size} bytes`);
