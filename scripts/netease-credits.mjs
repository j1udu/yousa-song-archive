const roleNames = new Map([
  ['作词', '作词'], ['作詞', '作词'], ['词', '作词'], ['詞', '作词'],
  ['lyrics', '作词'], ['lyricist', '作词'], ['lyrics by', '作词'],
  ['作曲', '作曲'], ['曲', '作曲'], ['composer', '作曲'], ['composed by', '作曲'],
  ['编曲', '编曲'], ['編曲', '编曲'], ['arranger', '编曲'], ['arrangement', '编曲'], ['arranged by', '编曲'],
  ['演唱', '演唱'], ['演唱者', '演唱'], ['主唱', '演唱'], ['歌手', '演唱'],
  ['vocal', '演唱'], ['vocals', '演唱'], ['vocal by', '演唱'], ['singer', '演唱'],
  ['翻唱', '翻唱'], ['原唱', '原唱'], ['填词', '填词'], ['填詞', '填词'],
]);

function names(value) {
  const withoutAnnotations = value.replace(/[（(][^()（）]*[:：][^()（）]*[）)]/g, '');
  return [...new Set(withoutAnnotations.split(/\s*(?:\/|\\|、|;|；|\s+&\s+)\s*/u)
    .map(s => s.replace(/[|\\\s]+$/, '').trim()).filter(s => s && !/[:：]/.test(s) && !/^(?:无|無|暂无|未知|佚名|纯音乐|纯音乐,?请欣赏|n\/?a|null|none|unknown|[-—]+)$/i.test(s)))];
}

// Keep factual credit lines only. Never retain or export the lyrics body.
export function extractCredits(payload) {
  const people = {};
  const evidence = [];
  for (const raw of (payload?.lrc?.lyric ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^(?:\[[^\]]*\]\s*)+/, '').trim();
    let matched = false;
    // Separators before a second role belong to a new credit. Separators in
    // "作词/作曲" are part of the first label and must not be split.
    const segments = line.replace(/(\s*[/\\|]\s*|\s+)(?=[^\s/\\|:：]{1,20}\s*[:：])/g,
      (separator, _group, offset) => /[:：]/.test(line.slice(0, offset)) ? '\n' : separator).split('\n');
    for (const segment of segments) {
      const match = segment.match(/^([^:：]{1,50})\s*[:：]\s*(.+)$/u);
      if (!match) continue;
      const label = match[1].trim().normalize('NFKC').toLowerCase();
      let roles = [];
      if (/^(?:词曲|詞曲|作词[\/、&]作曲|作詞[\/、&]作曲|作词作曲|词[\/、&]曲)$/.test(label)) roles = ['作词', '作曲'];
      else {
        roles = label.split(/\s*[\/、&]\s*/).map(r => roleNames.get(r.trim())).filter(Boolean);
        if (!roles.length && roleNames.has(label)) roles = [roleNames.get(label)];
      }
      if (!roles.length) continue;
      const values = names(match[2]);
      if (!values.length) continue;
      for (const role of new Set(roles)) people[role] = [...new Set([...(people[role] ?? []), ...values])];
      matched = true;
    }
    if (matched) evidence.push(line);
  }
  if (!people['演唱'] && people['翻唱']) people['演唱'] = [...people['翻唱']];
  return { people, evidence };
}

export function isInstrumental(title) {
  return /伴奏|instrumental|\boff\s*vocal\b|\bkaraoke\b/i.test(title);
}

export function mergeCredits(version, workPeople, incoming) {
  const people = structuredClone(version.people);
  const conflicts = [];
  for (const [role, values] of Object.entries(incoming)) {
    if (Object.hasOwn(people, role) || Object.hasOwn(workPeople, role)) {
      const existing = people[role] ?? workPeople[role];
      if (JSON.stringify([...existing].sort()) !== JSON.stringify([...values].sort())) conflicts.push({ role, existing, incoming: values });
    } else people[role] = values;
  }
  return { people, conflicts };
}
