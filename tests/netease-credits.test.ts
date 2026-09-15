import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCredits, isInstrumental, mergeCredits } from '../scripts/netease-credits.mjs';

test('extracts credit metadata, excludes lyrics and handles combined roles', () => {
  const result = extractCredits({ lrc: { lyric: '[00:00.00] 作词 : 甲/乙\n[00:01.00]词/曲：丙\n[00:02.00]Vocal：丁\n[00:03.00]这里不是署名\n[00:04.00]任意标签: 不导入' } });
  assert.deepEqual(result.people, { 作词: ['甲', '乙', '丙'], 作曲: ['丙'], 演唱: ['丁'] });
  assert.equal(result.evidence.length, 3);
  assert.ok(!JSON.stringify(result).includes('这里不是署名'));
});

test('does not treat unknown names as credits; cover credit supplies performer', () => {
  assert.deepEqual(extractCredits({ lrc: { lyric: '作词：暂无\n作曲：unknown\n翻唱：甲\n编曲/Arranger: 乙' } }).people, { 翻唱: ['甲'], 编曲: ['乙'], 演唱: ['甲'] });
  assert.deepEqual(extractCredits({ nolyric: true }).people, {});
  assert.ok(isInstrumental('歌曲（Instrumental）'));
  assert.ok(isInstrumental('歌曲 和声伴奏'));
  assert.ok(!isInstrumental('歌曲 (Live)'));
});

test('preserves existing version credits, work defaults and explicit empty overrides', () => {
  const original = { people: { 演唱: ['已审查'], 原唱: [] } };
  const result = mergeCredits(original, { 作曲: ['已知'] }, { 演唱: ['其他'], 作曲: ['其他'], 原唱: ['其他'], 编曲: ['新增'] });
  assert.deepEqual(result.people, { 演唱: ['已审查'], 原唱: [], 编曲: ['新增'] });
  assert.equal(result.conflicts.length, 3);
  assert.deepEqual(original.people, { 演唱: ['已审查'], 原唱: [] });
});

test('separates multiple roles on a line without splitting punctuation inside an artist name', () => {
  const result = extractCredits({ lrc: { lyric: '作曲：轩染 | 作词：甲\n翻唱：乙 / 原唱：丙\n作曲：丁 编曲：接个吻，开一枪\n原唱：苍穹（调音：某人）\n翻唱：戊\\己\n编曲：庚\\混音：某人' } });
  assert.deepEqual(result.people['作曲'], ['轩染', '丁']);
  assert.deepEqual(result.people['编曲'], ['接个吻，开一枪', '庚']);
  assert.deepEqual(result.people['演唱'], ['乙', '戊', '己']);
  assert.deepEqual(result.people['原唱'], ['丙', '苍穹']);
});

test('preserves combined role labels when normalizing previously extracted evidence', () => {
  const first = extractCredits({ lrc: { lyric: '作词/作曲/演唱：甲\n作曲/编曲/制作人：乙\n編曲：丙' } });
  assert.deepEqual(first.people, { 作词: ['甲'], 作曲: ['甲', '乙'], 演唱: ['甲'], 编曲: ['乙', '丙'] });
  assert.deepEqual(extractCredits({ lrc: { lyric: first.evidence.join('\n') } }), first);
});
