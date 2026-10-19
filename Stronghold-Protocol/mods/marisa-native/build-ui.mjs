import fs from 'node:fs';
import path from 'node:path';
import {legacy,game,rename} from './build-profile.mjs';
const read=p=>fs.readFileSync(path.join(legacy,p),'utf8');
const write=(p,s)=>fs.writeFileSync(path.join(game,p),s);
// Fallback labels remain available while the room is using vanilla data.
const catalogue=JSON.parse(read('data/mods/marisa/chess.json'));
const backups=JSON.parse(read('data/mods/marisa/backups.json'));
const {MOD_EXISTING_OPERATOR_IDS,MOD_ADDED_OPERATORS,MOD_BOND_IDS,MOD_STRATEGY_IDS,MOD_NEW_BOND_MEMBERS}=await import('./source/shared/mods.js');
const managedIds=new Set([...MOD_EXISTING_OPERATOR_IDS,...MOD_ADDED_OPERATORS.map(op=>op.charId),...MOD_NEW_BOND_MEMBERS.map(member=>member.charId)]);
const labels={};
for(const charId of managedIds){
 const operator=Object.values(catalogue).find(record=>record.charId===charId)||backups.units[charId];
 labels[charId]=operator.name;
}
// Room data may still be vanilla or reflect the previously applied settings. The draft's
// default checkboxes must instead follow the author's catalogue and current operator choices.
const defaultMembers=MOD_NEW_BOND_MEMBERS.filter(({bondId,charId})=>
 Object.values(catalogue).some(record=>record.charId===charId&&record.bonds?.includes(bondId))
 ||backups.diy?.operators?.[charId]?.bonds?.includes(bondId))
 .map(({bondId,charId})=>bondId+':'+charId);
for(const [table,ids]of [['bonds',MOD_BOND_IDS],['bands',MOD_STRATEGY_IDS]]){
 const records=JSON.parse(read('data/mods/marisa/'+table+'.json'));
 for(const id of ids)labels[id]=records[id].name;
}
const old=read('public/js/screens/lobby.js');
const start=old.indexOf('            <details class="mod-manager__group">');
const body=old.slice(start,old.indexOf('\n            `}',start))
 .replace("|| (id === 'rhodeShip' ? t('罗德岛') : id)", '|| labels[id] || id')
 .replace("|| (id === 'band_kun' ? t('鲲') : id)", '|| labels[id] || id')
 .replace(/\?\? !!\(data\.list\('chess'\)[\s\S]*?diy\?\.operators\?\.\[charId\]\?\.bonds\?\.includes\(id\)\);/,
  '?? defaultMemberChecked(id, charId);')
 .replace('<div class="mod-manager__list mod-manager__list--checks mod-manager__members">',
  '<p>${bondDescriptions[id]}</p>\n                <div class="mod-manager__list mod-manager__list--checks mod-manager__members">');
const names=old.slice(old.indexOf('  const diyOperators ='),old.indexOf('\n  const run =',old.indexOf('  const diyOperators =')))
 .replace('const modOperatorName = (charId) => diyOperators[charId]?.name',
  "const modOperatorName = (charId) => charId === 'char_1037_amiya3' ? t('阿米娅（医疗）') : diyOperators[charId]?.name");
write('public/js/ui/marisaSettings.js',rename(`import {useEffect,useState} from '../../vendor/hooks.module.js';
import {html,Button} from './components.js';
import {data,useData} from '../data.js';
import {t} from '../../../shared/i18n.js';
import {MOD_EXISTING_OPERATOR_IDS,MOD_ADDED_OPERATORS,MOD_BOND_IDS,MOD_NEW_BOND_MEMBERS,MOD_STRATEGY_IDS,enabledModBondMembers,normalizeModOptions,optionsFromSettings,settingsFromOptions} from '../../../shared/plugins/marisaProfile.js';
const labels=${JSON.stringify(labels,null,2)}; // i18n-ignore: fallback game names; loaded records provide localized names.
const defaultMembers=new Set(${JSON.stringify(defaultMembers,null,2)});
export function MarisaSettings({values={},disabled=false,onSave}){
  useData('chess','backups','bonds');
  const initial=optionsFromSettings(values),signature=JSON.stringify(initial);
  const [modOptions,setOptions]=useState(initial),[managerSearch,setManagerSearch]=useState('');
  useEffect(()=>setOptions(initial),[signature]);
  const modEnabled=!disabled,managerDataReady=true;
  const updateModOptions=fn=>setOptions(p=>normalizeModOptions(fn(p)));
  const baseOperators=MOD_EXISTING_OPERATOR_IDS.map(charId=>({charId,name:data.get('backups')?.units?.[charId]?.name||data.list('chess').find(c=>c.charId===charId)?.name||labels[charId]||charId}));
  const defaultMemberChecked=(bondId,charId)=>defaultMembers.has(bondId+':'+charId)
    && (MOD_ADDED_OPERATORS.some(operator=>operator.charId===charId)
      || (modOptions.existing.enabled&&!modOptions.existing.vanillaChars.includes(charId)));
  const bondDescriptions={
    rhodeShip:t('跟随其他盟约叠层，提供治疗，并将治疗转化为伤害。'),
    uniteShip:t('学生互助会救场；50 层保证进阶装备，100 层保证最高已解锁本数的干员。'),
    seesShip:t('控场回复技力，6 名成员解锁总攻击与神通法真伤。'),
  };
${names}
  return html\x60<form class="plugin-settings mod-manager" data-testid="marisa-settings" onSubmit=\x24{e=>{e.preventDefault();if(!disabled)onSave(settingsFromOptions(modOptions));}}>
  <strong>\x24{t('魔理沙 MOD 管理器')}</strong><p>\x24{t('房主应用后，加入者、观战者与重连者自动跟随房间配置。')}</p>
  <p>\x24{t('扩展共包含 10 位干员、3 条盟约、2 个策略和人格羁绊装备。')}</p>
  <p>\x24{t('人格羁绊可让装备者成为 S.E.E.S 成员；关闭 S.E.E.S 时，该装备一并关闭。')}</p>
${body}
  \x24{!disabled?html\x60<\x24{Button} type="submit" size="sm" disabled=\x24{JSON.stringify(modOptions)===signature}>\x24{t('应用设置')}<//>\x60:null}
  </form>\x60;
}
`).replace('|| charId;', '|| labels[charId] || charId;'));
// Presentation compatibility now lives in the current game files. Copying the frozen 0.3.0
// presentation here would undo upstream skins, effects and declarative-trait support.
const css=read('public/css/screens/lobby.css'),marker='/* Room-bound Marisa MOD options.';
const cssPath=path.join(game,'public/css/screens/lobby.css');
const existing=fs.readFileSync(cssPath,'utf8');
const at=existing.indexOf(marker);
// Rebuild the marker section idempotently. Keeping everything before the current section and normalising its
// trailing whitespace makes the build re-runnable: a naive `split(marker)[0] + '\n'` appended one blank line on
// every run, so a rebuild always dirtied lobby.css.
const head=(at>=0?existing.slice(0,at):existing).replace(/\s+$/,'')+'\n\n\n\n';
fs.writeFileSync(cssPath,head+css.slice(css.indexOf(marker))+'\n.mod-manager { max-width:100%; }\n');
for(const lang of ['en','ja','ko','zh-TW']){
 const p='public/i18n/'+lang+'.json';
 const target=JSON.parse(fs.readFileSync(path.join(game,p),'utf8')),source=JSON.parse(read(p));
 for(const [k,v]of Object.entries(source))if(!Object.hasOwn(target,k))target[k]=v;
 write(p,JSON.stringify(target,null,2)+'\n');
}
console.log('Native manager and presentation migrated');
