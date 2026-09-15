import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isUsableLyrics, normalizeLyrics } from './netease-lyrics.mjs';

const root = process.cwd();
const mapPath = process.argv[2];
const apply = process.argv.includes('--apply');
if (!mapPath) throw new Error('Usage: node scripts/import-netease-lyrics.mjs <source-map.json> [--apply]');

const sourceMap = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const sourceFile = path.join(root, sourceMap.source);
const sourceBytes = await fs.readFile(sourceFile);
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(sourceBytes) !== sourceMap.sourceSha256) throw new Error('Review workbook changed; rebuild and verify the source map first.');

const byWork = new Map();
for (const record of sourceMap.records) {
  if (!/^\d+$/.test(record.songId) || !/^[a-z0-9-]+$/.test(record.workId) || !/^[a-z0-9-]+$/.test(record.versionId)) throw new Error('Invalid source mapping');
  if (!byWork.has(record.workId)) byWork.set(record.workId, []);
  byWork.get(record.workId).push(record);
}

const pending = [...byWork.entries()];
const proposals = [];
const report = [];
let completed = 0;

async function requestLyrics(songId) {
  const url = new URL('/api/song/lyric', 'https://music.163.com');
  for (const [key, value] of Object.entries({ id: songId, lv: '-1', kv: '-1', tv: '-1' })) url.searchParams.set(key, value);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.code !== 200) throw new Error(`NetEase returned ${payload.code}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 700));
    }
  }
  throw lastError;
}

async function processWork(workId, records) {
  const workDir = path.join(root, 'public/content/works', workId);
  const workFile = path.join(workDir, 'work.json');
  const before = await fs.readFile(workFile, 'utf8');
  const work = JSON.parse(before);
  const ordered = work.versionOrder.map(versionId => records.find(record => record.versionId === versionId)).filter(Boolean);
  if (ordered.length !== records.length) throw new Error(`${workId}: source map does not match versionOrder`);

  const attempts = [];
  let selected = null;
  for (const record of ordered) {
    try {
      const payload = await requestLyrics(record.songId);
      const lyrics = normalizeLyrics(payload.lrc?.lyric ?? '');
      const usable = !payload.nolyric && !payload.uncollected && isUsableLyrics(lyrics);
      attempts.push({ songId: record.songId, versionId: record.versionId, status: usable ? 'selected' : payload.nolyric ? 'no_lyrics' : payload.uncollected ? 'uncollected' : 'empty' });
      if (usable) { selected = { record, lyrics }; break; }
    } catch (error) {
      attempts.push({ songId: record.songId, versionId: record.versionId, status: 'error', error: error.message });
    }
  }

  if (!selected) return { workId, title: work.title, selectedSongId: null, selectedVersionId: null, status: attempts.some(item => item.status === 'error') ? 'error' : 'missing', attempts };

  const lyricsFile = path.join(workDir, 'lyrics.txt');
  let lyricsBefore = null;
  try { lyricsBefore = await fs.readFile(lyricsFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const nextWork = { ...work, lyrics: 'lyrics.txt' };
  const workOutput = `${JSON.stringify(nextWork, null, 2)}\n`;
  if (lyricsBefore !== selected.lyrics || before !== workOutput) proposals.push({ workFile, workHash: sha(before), workOutput, lyricsFile, lyricsHash: lyricsBefore === null ? null : sha(lyricsBefore), lyricsOutput: selected.lyrics });
  return { workId, title: work.title, selectedSongId: selected.record.songId, selectedVersionId: selected.record.versionId, status: 'ready', lineCount: selected.lyrics.trimEnd().split('\n').length, attempts };
}

async function worker() {
  while (pending.length) {
    const item = pending.shift();
    if (!item) return;
    report.push(await processWork(...item));
    completed += 1;
    if (completed % 25 === 0 || completed === byWork.size) console.log(JSON.stringify({ processed: completed, total: byWork.size }));
  }
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
report.sort((a, b) => a.workId.localeCompare(b.workId));
const summary = {
  works: byWork.size,
  ready: report.filter(item => item.status === 'ready').length,
  missing: report.filter(item => item.status === 'missing').length,
  errors: report.filter(item => item.status === 'error').length,
  changedWorks: proposals.length,
};

if (apply) {
  if (sha(await fs.readFile(sourceFile)) !== sourceMap.sourceSha256) throw new Error('Source workbook changed during fetch');
  for (const proposal of proposals) {
    if (sha(await fs.readFile(proposal.workFile)) !== proposal.workHash) throw new Error(`File changed: ${proposal.workFile}`);
    let currentLyrics = null;
    try { currentLyrics = await fs.readFile(proposal.lyricsFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if ((currentLyrics === null ? null : sha(currentLyrics)) !== proposal.lyricsHash) throw new Error(`File changed: ${proposal.lyricsFile}`);
  }
  for (const proposal of proposals) {
    await fs.writeFile(proposal.lyricsFile, proposal.lyricsOutput);
    await fs.writeFile(proposal.workFile, proposal.workOutput);
  }
}

const outputDir = path.join(root, 'outputs/song-metadata');
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'netease-lyrics-report.json'), `${JSON.stringify({ source: sourceMap.source, sourceSha256: sourceMap.sourceSha256, summary, records: report }, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, applied: apply }));
