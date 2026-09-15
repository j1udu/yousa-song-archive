export function normalizeLyrics(value) {
  if (typeof value !== 'string') return '';

  const lines = [];
  for (const raw of value.replace(/[\u0000\uFEFF]/g, '').split(/\r?\n/)) {
    const line = raw
      .replace(/^(?:\[(?:\d{1,3}:)?\d{1,2}(?:[.:]\d{1,3})?(?:-?\d+)?\]\s*)+/u, '')
      .replace(/^\[(?:ar|al|ti|by|offset|re|ve):[^\]]*\]\s*$/iu, '')
      .trim();
    if (/^(?:纯音乐[，,]?请欣赏|暂无歌词)$/u.test(line.trim())) continue;
    if (!line.trim()) {
      if (lines.length && lines.at(-1) !== '') lines.push('');
      continue;
    }
    lines.push(line);
  }

  while (lines.at(-1) === '') lines.pop();
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function isUsableLyrics(value) {
  const lines = normalizeLyrics(value).trim().split('\n').filter(Boolean);
  return lines.some(line => !/^(?:作词|作詞|词|詞|作曲|编曲|編曲|演唱|歌手|翻唱|原唱|制作人|监制|混音|母带|录音|和声|吉他|贝斯|鼓|统筹|策划|出品|发行|版权|词曲版权归属)[^:：]{0,20}[:：]/iu.test(line));
}
