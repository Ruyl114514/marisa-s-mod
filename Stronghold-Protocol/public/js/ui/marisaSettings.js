import {useEffect,useState} from '../../vendor/hooks.module.js';
import {html,Button} from './components.js';
import {data,useData} from '../data.js';
import {t} from '../../../shared/i18n.js';
import {MOD_EXISTING_OPERATOR_IDS,MOD_ADDED_OPERATORS,MOD_BOND_IDS,MOD_NEW_BOND_MEMBERS,MOD_STRATEGY_IDS,enabledModBondMembers,normalizeModOptions,optionsFromSettings,settingsFromOptions} from '../../../shared/plugins/marisaProfile.js';
const labels={
  "char_171_bldsk": "华法琳",
  "char_196_sunbr": "古米",
  "char_003_kalts": "凯尔希",
  "char_4179_monstr": "Mon3tr",
  "char_4195_radian": "电弧",
  "char_4228_closur": "可露希尔",
  "char_4230_mcnist": "机械师",
  "char_1015_aglna2": "予愿安洁莉娜",
  "char_1052_kalts2": "凯尔希·思衡托",
  "char_1051_headb2": "怒潮凛冬",
  "char_188_helage": "赫拉格",
  "char_x_marisa_makoto": "结城理",
  "char_x_marisa_amiya3": "阿米娅",
  "char_x_marisa_headbr": "凛冬",
  "char_x_marisa_kormr": "虎狼丸",
  "char_x_marisa_aigis": "埃癸斯",
  "char_x_marisa_yukari": "岳羽由加莉",
  "bond_x_marisa_rhodeShip": "罗德岛",
  "bond_x_marisa_seesShip": "S.E.E.S",
  "bond_x_marisa_uniteShip": "我们联合",
  "band_x_marisa_kun": "鲲",
  "band_x_marisa_unite": "怒潮凛冬"
}; // i18n-ignore: fallback game names; loaded records provide localized names.
const defaultMembers=new Set([
  "bond_x_marisa_rhodeShip:char_171_bldsk",
  "bond_x_marisa_rhodeShip:char_1052_kalts2",
  "bond_x_marisa_rhodeShip:char_x_marisa_amiya3",
  "bond_x_marisa_rhodeShip:char_003_kalts",
  "bond_x_marisa_rhodeShip:char_4179_monstr",
  "bond_x_marisa_rhodeShip:char_4195_radian",
  "bond_x_marisa_rhodeShip:char_4228_closur",
  "bond_x_marisa_rhodeShip:char_4230_mcnist",
  "bond_x_marisa_seesShip:char_x_marisa_makoto",
  "bond_x_marisa_seesShip:char_x_marisa_kormr",
  "bond_x_marisa_seesShip:char_x_marisa_aigis",
  "bond_x_marisa_seesShip:char_x_marisa_yukari",
  "bond_x_marisa_uniteShip:char_196_sunbr",
  "bond_x_marisa_uniteShip:char_x_marisa_headbr",
  "bond_x_marisa_uniteShip:char_1051_headb2",
  "bond_x_marisa_uniteShip:char_188_helage"
]);
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
    bond_x_marisa_rhodeShip:t('跟随其他盟约叠层，提供治疗，并将治疗转化为伤害。'),
    bond_x_marisa_uniteShip:t('学生互助会救场；50 层保证进阶装备，100 层保证最高已解锁本数的干员。'),
    bond_x_marisa_seesShip:t('控场回复技力，6 名成员解锁总攻击与神通法真伤。'),
  };
  const diyOperators = data.get('backups')?.units || {};
  const renderBaseOperators = baseOperators;
  const modOperatorName = (charId) => charId === 'char_x_marisa_amiya3' ? t('阿米娅（医疗）') : diyOperators[charId]?.name
    || data.list('chess').find((c) => c?.charId === charId)?.name
    || labels[charId] || charId;
  const existingBondMemberGroups = new Map();
  for (const member of enabledModBondMembers(modOptions)) {
    const members = existingBondMemberGroups.get(member.bondId) || [];
    members.push(member);
    existingBondMemberGroups.set(member.bondId, members);
  }

  return html`<form class="plugin-settings mod-manager" data-testid="marisa-settings" onSubmit=${e=>{e.preventDefault();if(!disabled)onSave(settingsFromOptions(modOptions));}}>
  <strong>${t('魔理沙 MOD 管理器')}</strong><p>${t('房主应用后，加入者、观战者与重连者自动跟随房间配置。')}</p>
  <p>${t('扩展共包含 10 位干员、3 条盟约、2 个策略和人格羁绊装备。')}</p>
  <p>${t('人格羁绊可让装备者成为 S.E.E.S 成员；关闭 S.E.E.S 时，该装备一并关闭。')}</p>
            <details class="mod-manager__group">
              <summary>${t('已有干员的魔理沙 MOD 改动')} <span>${renderBaseOperators.length}</span></summary>
              <label><input type="checkbox" checked=${modOptions.existing.enabled} disabled=${!modEnabled} onChange=${(ev) => updateModOptions((p) => ({ ...p, existing: { ...p.existing, enabled: ev.target.checked } }))} /> ${t('启用已有干员的魔理沙 MOD 改动')}</label>
              <p>${t('仅列出当前数据中受魔理沙 MOD 改动的原版干员。')}</p>
              <input class="mod-manager__search" type="search" placeholder=${t('搜索干员')} disabled=${!modEnabled} value=${managerSearch} onInput=${(ev) => setManagerSearch(ev.target.value)} />
              ${managerDataReady ? html`<div class="mod-manager__list">
                ${renderBaseOperators.filter((op) => !managerSearch || op.name.toLowerCase().includes(managerSearch.toLowerCase()) || op.charId.toLowerCase().includes(managerSearch.toLowerCase())).map((op) => html`
                  <label key=${op.charId} title=${op.charId}>
                    <span>${op.name}</span>
                    <select disabled=${!modEnabled || !modOptions.existing.enabled} value=${modOptions.existing.vanillaChars.includes(op.charId) ? 'original' : 'mod'} onChange=${(ev) => updateModOptions((p) => ({
                      ...p, existing: { ...p.existing, vanillaChars: ev.target.value === 'original'
                        ? [...new Set([...p.existing.vanillaChars, op.charId])]
                        : p.existing.vanillaChars.filter((id) => id !== op.charId) },
                    }))}>
                      <option value="original">${t('原版效果')}</option><option value="mod">${t('魔理沙 MOD 改动')}</option>
                    </select>
                  </label>`)}
              </div>` : html`<p>${t('正在读取干员数据…')}</p>`}
            </details>
            <details class="mod-manager__group">
              <summary>${t('追加干员')} <span>${MOD_ADDED_OPERATORS.length}</span></summary>
              <label><input type="checkbox" checked=${modOptions.additions.enabled} disabled=${!modEnabled} onChange=${(ev) => updateModOptions((p) => ({ ...p, additions: { ...p.additions, enabled: ev.target.checked } }))} /> ${t('启用追加干员')}</label>
              <p>${t('自选候选在 V、VI 阶均可选择，同一干员只能编入一个位置；不会进入普通商店。')}</p>
              <div class="mod-manager__list mod-manager__list--operators">
                ${MOD_ADDED_OPERATORS.map((op) => html`<label key=${op.charId} title=${op.charId}>
                  <input type="checkbox" checked=${!modOptions.additions.disabledChars.includes(op.charId)} disabled=${!modEnabled || !modOptions.additions.enabled} aria-label=${t('启用此干员')} onChange=${(ev) => updateModOptions((p) => ({
                    ...p, additions: { ...p.additions, disabledChars: ev.target.checked
                      ? p.additions.disabledChars.filter((id) => id !== op.charId)
                      : [...new Set([...p.additions.disabledChars, op.charId])].sort() },
                  }))} />
                  <span>${modOperatorName(op.charId)}</span>
                  <select disabled=${!modEnabled || !modOptions.additions.enabled || modOptions.additions.disabledChars.includes(op.charId)} value=${modOptions.additions.diyChars.includes(op.charId) ? 'diy' : 'shop'} onChange=${(ev) => updateModOptions((p) => ({
                    ...p, additions: { ...p.additions, diyChars: ev.target.value === 'diy'
                      ? [...new Set([...p.additions.diyChars, op.charId])]
                      : p.additions.diyChars.filter((id) => id !== op.charId) },
                  }))}>
                    <option value="shop">${t('按魔理沙 MOD 默认方式从商店获取')}</option><option value="diy">${t('加入自选候选名单')}</option>
                  </select>
                </label>`)}
              </div>
            </details>
            <details class="mod-manager__group">
              <summary>${t('现有盟约追加干员')} <span>${existingBondMemberGroups.size}</span></summary>
              <p>${t('选择是否将已启用的魔理沙 MOD 干员加入对应的原版盟约；关闭干员后会隐藏它的盟约选项。')}</p>
              ${existingBondMemberGroups.size ? [...existingBondMemberGroups.entries()].map(([bondId, members]) => html`
                <details class="mod-manager__group mod-manager__group--nested" key=${bondId}>
                  <summary>${data.lookup('bonds', bondId)?.name || bondId} <span>${members.length}</span></summary>
                  <div class="mod-manager__list mod-manager__list--checks">
                    ${members.map(({ charId }) => {
                      const memberId = `${bondId}:${charId}`;
                      return html`<label key=${memberId} title=${memberId}>
                        <span>${modOperatorName(charId)}</span>
                        <input type="checkbox" checked=${!modOptions.existingBondMembers.disabledIds.includes(memberId)} disabled=${!modEnabled} aria-label=${t('加入此盟约')} onChange=${(ev) => updateModOptions((p) => ({
                          ...p, existingBondMembers: { disabledIds: ev.target.checked
                            ? p.existingBondMembers.disabledIds.filter((id) => id !== memberId)
                            : [...new Set([...p.existingBondMembers.disabledIds, memberId])].sort() },
                        }))} />
                      </label>`;
                    })}
                  </div>
                </details>`)
                : html`<p>${t('当前没有已启用的干员可加入原版盟约。')}</p>`}
            </details>
            <details class="mod-manager__group">
              <summary>${t('追加盟约')} <span>${MOD_BOND_IDS.length}</span></summary>
              <label><input type="checkbox" checked=${modOptions.bonds.enabled} disabled=${!modEnabled} onChange=${(ev) => updateModOptions((p) => ({ ...p, bonds: { ...p.bonds, enabled: ev.target.checked } }))} /> ${t('启用追加盟约')}</label>
              <p>${t('关闭选项只会移除魔理沙 MOD 新增的盟约归属；无盟约的在场干员自动使用协防干员。')}</p>
              <p>${t('成员开关优先于干员的原版或 MOD 选择，只改变盟约归属；盟约总开关关闭时所有成员均不生效。')}</p>
              ${MOD_BOND_IDS.map((id) => html`<div class="mod-manager__bond" key=${id}>
                <label title=${id}>
                  <span>${data.lookup('bonds', id)?.name || labels[id] || id}</span>
                  <input type="checkbox" checked=${modOptions.bonds.enabled && !modOptions.bonds.disabledIds.includes(id)} disabled=${!modEnabled || !modOptions.bonds.enabled} onChange=${(ev) => updateModOptions((p) => ({
                    ...p, bonds: { ...p.bonds, disabledIds: ev.target.checked ? p.bonds.disabledIds.filter((x) => x !== id) : [...new Set([...p.bonds.disabledIds, id])].sort() },
                  }))} />
                </label>
                <p>${bondDescriptions[id]}</p>
                <div class="mod-manager__list mod-manager__list--checks mod-manager__members">
                  ${MOD_NEW_BOND_MEMBERS.filter((member) => member.bondId === id
                    && (!MOD_ADDED_OPERATORS.some((op) => op.charId === member.charId)
                      || (modOptions.additions.enabled && !modOptions.additions.disabledChars.includes(member.charId)))).map(({ charId }) => {
                    const memberId = `${id}:${charId}`;
                    const checked = modOptions.bonds.memberOverrides[memberId]
                      ?? defaultMemberChecked(id, charId);
                    return html`<label key=${memberId} title=${memberId}>
                      <span>${modOperatorName(charId)}</span>
                      <input type="checkbox" checked=${checked} disabled=${!modEnabled || !modOptions.bonds.enabled || modOptions.bonds.disabledIds.includes(id)} aria-label=${t('加入此盟约')} onChange=${(ev) => updateModOptions((p) => ({
                        ...p, bonds: { ...p.bonds, memberOverrides: { ...p.bonds.memberOverrides, [memberId]: ev.target.checked } },
                      }))} />
                    </label>`;
                  })}
                </div>
              </div>`)}
            </details>
            <details class="mod-manager__group">
              <summary>${t('追加策略')} <span>${MOD_STRATEGY_IDS.length}</span></summary>
              <label><input type="checkbox" checked=${modOptions.strategies.enabled} disabled=${!modEnabled} onChange=${(ev) => updateModOptions((p) => ({ ...p, strategies: { ...p.strategies, enabled: ev.target.checked } }))} /> ${t('启用追加策略')}</label>
              <div class="mod-manager__list mod-manager__list--checks">
                ${MOD_STRATEGY_IDS.map((id) => html`<label key=${id} title=${id}>
                  <span>${data.lookup('bands', id)?.name || labels[id] || id}</span>
                  <input type="checkbox" checked=${modOptions.strategies.enabled && !modOptions.strategies.disabledIds.includes(id)} disabled=${!modEnabled || !modOptions.strategies.enabled} onChange=${(ev) => updateModOptions((p) => ({
                    ...p, strategies: { ...p.strategies, disabledIds: ev.target.checked ? p.strategies.disabledIds.filter((x) => x !== id) : [...new Set([...p.strategies.disabledIds, id])].sort() },
                  }))} />
                </label>`)}
              </div>
            </details>
  ${!disabled?html`<${Button} type="submit" size="sm" disabled=${JSON.stringify(modOptions)===signature}>${t('应用设置')}<//>`:null}
  </form>`;
}
