import assert from 'node:assert/strict';
import test from 'node:test';
import { isUsableLyrics, normalizeLyrics } from '../scripts/netease-lyrics.mjs';

test('normalizes LRC into readable plain text', () => {
  const source = '[ar:歌手]\n[00:00.00] 作词：甲\r\n[00:12.34]第一句\n\uFEFF[00:15.5][00:30.50]第二句\n\n';
  assert.equal(normalizeLyrics(source), '作词：甲\n第一句\n第二句\n');
});

test('rejects empty, instrumental and credits-only lyrics', () => {
  assert.equal(isUsableLyrics('[00:00.00]纯音乐，请欣赏'), false);
  assert.equal(isUsableLyrics('[00:00.00]作词：甲\n[00:01.00]作曲：乙'), false);
  assert.equal(isUsableLyrics('[00:00.00-1] 作曲 : 甲\n[00:00.00-1] 编曲 : 甲'), false);
  assert.equal(isUsableLyrics('[00:00.00]作词：甲\n[00:10.00]正文'), true);
});
