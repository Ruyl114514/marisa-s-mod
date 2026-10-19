// Native settings stay within the host's existing 32-setting limit.
// Only the transport uses integer masks; the manager and composition keep named ID lists.
import {
  MOD_EXISTING_OPERATOR_IDS, MOD_ADDED_OPERATORS, MOD_ADDED_BOND_MEMBERS,
  MOD_NEW_BOND_MEMBERS, defaultModOptions, normalizeModOptions,
} from './mods.js';

const BOND_SETTINGS = {
  rhode: 'rhodeShip',
  sees: 'seesShip',
  unite: 'uniteShip',
};
const STRATEGY_SETTINGS = {kun: 'band_kun', uniteBand: 'band_unite'};
const suffixOf = id => id.split('_').at(-1);
const memberId = ({bondId, charId}) => `${bondId}:${charId}`;
const booleanSetting = label => ({type: 'boolean', default: true, label: {zh: label}});
const enumSetting = (label, options, initial) => ({type: 'enum', options, default: initial, label: {zh: label}});
const membershipSetting = (label, members) => ({
  type: 'integer', min: 0, max: 2 ** members.length - 1, default: 0, label: {zh: label},
});

// Catalogue order is part of the saved-settings format. Append new members at the end.
// Arithmetic avoids JavaScript's signed 32-bit bitwise conversion.
function encodeMembers(members, selected) {
  return members.reduce((mask, member, index) => selected(member) ? mask + 2 ** index : mask, 0);
}
function decodeMembers(members, mask = 0) {
  return members.filter((member, index) => Math.floor(mask / 2 ** index) % 2 === 1);
}

export const MARISA_SETTINGS = {
  existing: booleanSetting('启用已有干员改动'),
  additions: booleanSetting('启用追加干员'),
  bonds: booleanSetting('启用追加盟约'),
  rhode: booleanSetting('罗德岛'),
  sees: booleanSetting('S.E.E.S'),
  unite: booleanSetting('我们联合'),
  strategies: booleanSetting('启用追加策略'),
  kun: booleanSetting('鲲'),
  uniteBand: booleanSetting('怒潮凛冬'),
};
for (const charId of MOD_EXISTING_OPERATOR_IDS) {
  MARISA_SETTINGS[`op_${suffixOf(charId)}`] = enumSetting(charId, ['mod', 'original'], 'mod');
}
for (const {charId} of MOD_ADDED_OPERATORS) {
  MARISA_SETTINGS[`add_${suffixOf(charId)}`] = enumSetting(charId, ['shop', 'diy', 'disabled'], 'shop');
}
MARISA_SETTINGS.memberOff = membershipSetting('原版盟约成员选择', MOD_ADDED_BOND_MEMBERS);
MARISA_SETTINGS.memberYes = membershipSetting('追加盟约加入选择', MOD_NEW_BOND_MEMBERS);
MARISA_SETTINGS.memberNo = membershipSetting('追加盟约移除选择', MOD_NEW_BOND_MEMBERS);

export function optionsFromSettings(settings = {}) {
  const options = defaultModOptions();
  options.existing.enabled = settings.existing !== false;
  options.existing.vanillaChars = MOD_EXISTING_OPERATOR_IDS.filter(id => settings[`op_${suffixOf(id)}`] === 'original');
  options.additions.enabled = settings.additions !== false;
  options.additions.disabledChars = MOD_ADDED_OPERATORS.filter(({charId}) => settings[`add_${suffixOf(charId)}`] === 'disabled').map(op => op.charId);
  options.additions.diyChars = MOD_ADDED_OPERATORS.filter(({charId}) => settings[`add_${suffixOf(charId)}`] === 'diy').map(op => op.charId);
  options.bonds.enabled = settings.bonds !== false;
  options.bonds.disabledIds = Object.entries(BOND_SETTINGS).filter(([key]) => settings[key] === false).map(([, id]) => id);
  options.strategies.enabled = settings.strategies !== false;
  options.strategies.disabledIds = Object.entries(STRATEGY_SETTINGS).filter(([key]) => settings[key] === false).map(([, id]) => id);
  options.existingBondMembers.disabledIds = decodeMembers(MOD_ADDED_BOND_MEMBERS, settings.memberOff).map(memberId);
  for (const member of decodeMembers(MOD_NEW_BOND_MEMBERS, settings.memberYes)) options.bonds.memberOverrides[memberId(member)] = true;
  for (const member of decodeMembers(MOD_NEW_BOND_MEMBERS, settings.memberNo)) options.bonds.memberOverrides[memberId(member)] = false;

  // Read the old manager's individual member keys when importing saved preferences.
  if (settings.memberOff === undefined) {
    options.existingBondMembers.disabledIds = MOD_ADDED_BOND_MEMBERS.filter(({bondId, charId}) =>
      settings[`m_${bondId}_${suffixOf(charId)}`] === false).map(memberId);
  }
  if (settings.memberYes === undefined && settings.memberNo === undefined) {
    for (const member of MOD_NEW_BOND_MEMBERS.filter(member => member.bondId === BOND_SETTINGS.rhode)) {
      const value = settings[`n_${suffixOf(member.charId)}`];
      if (value === 'yes' || value === 'no') options.bonds.memberOverrides[memberId(member)] = value === 'yes';
    }
  }
  return normalizeModOptions(options);
}

export function settingsFromOptions(raw) {
  const options = normalizeModOptions(raw);
  const settings = {
    existing: options.existing.enabled,
    additions: options.additions.enabled,
    bonds: options.bonds.enabled,
    strategies: options.strategies.enabled,
  };
  for (const [key, id] of Object.entries(BOND_SETTINGS)) settings[key] = !options.bonds.disabledIds.includes(id);
  for (const [key, id] of Object.entries(STRATEGY_SETTINGS)) settings[key] = !options.strategies.disabledIds.includes(id);
  for (const charId of MOD_EXISTING_OPERATOR_IDS) {
    settings[`op_${suffixOf(charId)}`] = options.existing.vanillaChars.includes(charId) ? 'original' : 'mod';
  }
  for (const {charId} of MOD_ADDED_OPERATORS) {
    settings[`add_${suffixOf(charId)}`] = options.additions.disabledChars.includes(charId) ? 'disabled'
      : options.additions.diyChars.includes(charId) ? 'diy' : 'shop';
  }
  settings.memberOff = encodeMembers(MOD_ADDED_BOND_MEMBERS, member => options.existingBondMembers.disabledIds.includes(memberId(member)));
  settings.memberYes = encodeMembers(MOD_NEW_BOND_MEMBERS, member => options.bonds.memberOverrides[memberId(member)] === true);
  settings.memberNo = encodeMembers(MOD_NEW_BOND_MEMBERS, member => options.bonds.memberOverrides[memberId(member)] === false);
  return settings;
}
