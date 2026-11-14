import editorial from './editorial.json' with {type:'json'};
const taskOrder = new Map(Object.keys(editorial).map((id,index) => [id,index]));
export function skillCopy(item) {return editorial[item.id]?.revision === item.source.commit ? editorial[item.id] : undefined;}

/** Presentation of known entry conditions; Host remains the installation authority. */
export function installationBlock(item) {
  return item.installation?.allowed ? '' : item.installation?.reason || 'Admission not provided by Host; refresh or update Pero.';
}

/** A bounded view of a catalog. Installation and compatibility rules stay in Host. */
export function findSkills(skills, {query = '', category = '', scope = '', view = 'discover', installed = [], page = 0, onlyReady = false, sort = 'name'} = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const installedIds = new Set(installed.map(item => item.id));
  const matches = skills.filter(item => {
    if (view === 'installed' && !installedIds.has(item.id)) return false;
    const scopes = item.discovery_scopes || (item.kind === 'general_skill' ? ['general'] : ['research']);
    if (scope && !scopes.includes(scope)) return false;
    if (category && item.category !== category) return false;
    if (onlyReady && installationBlock(item)) return false;
    const copy = skillCopy(item);
    const text = [item.name,item.title_zh,item.description,item.description_zh,copy?.title,copy?.summary,item.category_zh,item.source?.repository].filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  }).sort((a,b) => (sort === 'flow' ? (taskOrder.get(a.id) ?? 10000) - (taskOrder.get(b.id) ?? 10000) : 0) || a.name.localeCompare(b.name, 'en', {numeric:true}) || a.id.localeCompare(b.id, 'en'));
  const pages = Math.max(1, Math.ceil(matches.length / 12));
  const shown = Math.min(Math.max(0, page), pages - 1);
  return {items: matches.slice(shown * 12, (shown + 1) * 12), total: matches.length, page: shown, pages};
}

/** Groups a page by source owner without changing the caller's item order inside a group. */
export function groupSkills(skills) {
  const groups = [], index = new Map();
  for (const item of skills) {
    const owner = String(item.source?.repository || '').split('/')[0];
    let group = index.get(owner);
    if (!group) { group = {owner, items: []}; index.set(owner, group); groups.push(group); }
    group.items.push(item);
  }
  return groups;
}
