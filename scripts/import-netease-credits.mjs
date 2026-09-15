import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { extractCredits, isInstrumental, mergeCredits } from './netease-credits.mjs';

const root = process.cwd();
const mapPath = process.argv[2];
if (!mapPath) throw new Error('Usage: node scripts/import-netease-credits.mjs <source-map.json> [--apply]');
const apply = process.argv.includes('--apply');
const sourceMap = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const sourceBytes = await fs.readFile(path.join(root, sourceMap.source));
if (createHash('sha256').update(sourceBytes).digest('hex') !== sourceMap.sourceSha256) throw new Error('Review workbook changed; rebuild and verify the source map first.');
const cacheRoot = path.join(root, '.netease-credits-cache');
await fs.mkdir(cacheRoot, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const proposals = [];
const report = [];
const artistSongs = new Map();

function request(endpoint, params) {
  const url = new URL(endpoint, 'https://music.163.com');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const data = JSON.parse(execFileSync('curl', ['--silent', '--show-error', '--fail', '--max-time', '20', '--retry', '1', '--referer', 'https://music.163.com/', url.href], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
  if (data.code !== 200) throw new Error(`NetEase returned ${data.code}`);
  return data;
}

async function fetchMetadata(id) {
  const cacheFile = path.join(cacheRoot, `${id}.json`);
  try {
    const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (process.argv.includes('--refresh-credits')) {
      await setTimeout(600);
      const payload = request('/api/song/lyric', { id, lv: '-1', kv: '-1', tv: '-1' });
      Object.assign(saved, extractCredits(payload));
      saved.creditsFetchedAt = new Date().toISOString();
      saved.creditStatus = payload.nolyric ? 'no_lyrics' : saved.evidence.length ? 'credits_found' : 'no_credits';
    } else Object.assign(saved, extractCredits({ lrc: { lyric: saved.evidence.join('\n') } }));
    if (artistSongs.has(id)) {
      Object.assign(saved, artistSongs.get(id));
      saved.errors = saved.errors.filter(e => !e.startsWith('detail:'));
    }
    await fs.writeFile(cacheFile, JSON.stringify(saved, null, 2) + '\n');
    return saved;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const record = { songId: id, fetchedAt: new Date().toISOString(), people: {}, evidence: [], errors: [] };
  try {
    const detail = request('/api/song/detail/', { id, ids: JSON.stringify([Number(id)]) });
    const song = detail.songs?.find(s => String(s.id) === id);
    if (!song) throw new Error('Song ID absent from detail response');
    record.title = song.name;
    record.albumId = String(song.album?.id ?? '');
    record.album = song.album?.name ?? '';
    record.artists = (song.artists ?? []).map(a => a.name).filter(Boolean);
  } catch (error) { record.errors.push(`detail: ${error.message}`); }
  try {
    const payload = request('/api/song/lyric', { id, lv: '-1', kv: '-1', tv: '-1' });
    Object.assign(record, extractCredits(payload));
    record.creditStatus = payload.nolyric ? 'no_lyrics' : record.evidence.length ? 'credits_found' : 'no_credits';
  } catch (error) { record.errors.push(`credits: ${error.message}`); }
  // The cache contains credits and attribution facts only, not lyric text.
  await fs.writeFile(cacheFile, JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv.includes('--refresh-artists')) {
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const data = request('/api/v1/artist/songs', { id: '1047282', limit: '100', offset: String(offset), order: 'hot' });
    if (!Array.isArray(data.songs) || !Number.isInteger(data.total) || !data.songs.length) throw new Error('Invalid artist pagination response');
    total = data.total;
    for (const song of data.songs) artistSongs.set(String(song.id), {
      title: song.name, albumId: String(song.album?.id ?? ''), album: song.album?.name ?? '',
      artists: (song.artists ?? []).map(a => a.name).filter(Boolean),
      detailSource: 'artist/songs', detailFetchedAt: new Date().toISOString(),
    });
    offset += data.songs.length;
    console.log(JSON.stringify({ artistPageFetched: offset, total }));
    if (offset < total && data.more === false) throw new Error('Artist pagination ended before total');
    if (offset < total) await setTimeout(1500);
  }
  if (artistSongs.size !== total) throw new Error('Duplicate or missing artist song IDs');
}

for (const [index, item] of sourceMap.records.entries()) {
  if (!/^\d+$/.test(item.songId) || !/^public\/content\/works\/[a-z0-9-]+\/version-[a-z0-9-]+\.json$/.test(item.file)) throw new Error('Invalid source mapping');
  const file = path.join(root, item.file);
  const before = await fs.readFile(file, 'utf8');
  const version = JSON.parse(before);
  const work = JSON.parse(await fs.readFile(path.join(path.dirname(file), 'work.json'), 'utf8'));
  const metadata = await fetchMetadata(item.songId);
  const incoming = structuredClone(metadata.people);
  const instrumental = isInstrumental(item.reviewTitle) || isInstrumental(metadata.title ?? '');
  if (instrumental) for (const role of ['演唱', '翻唱', '原唱']) delete incoming[role];
  if (metadata.artists?.length) incoming['网易云艺人'] = [...new Set(metadata.artists)];
  const merged = mergeCredits(version, work.people, incoming);
  const after = { ...version, people: merged.people, links: [...version.links] };
  const sourceUrl = `https://music.163.com/#/song?id=${item.songId}`;
  if (!after.links.some(link => link.url === sourceUrl)) after.links.push({ platform: '网易云音乐', url: sourceUrl, label: '网易云条目' });
  const output = JSON.stringify(after, null, 2) + '\n';
  if (output !== before) proposals.push({ file, beforeHash: sha(before), output });
  report.push({ ...item, sourceUrl, metadata, instrumental, addedRoles: Object.keys(incoming).filter(role => !Object.hasOwn(version.people, role) && !Object.hasOwn(work.people, role)), conflicts: merged.conflicts,
    missing: ['作词', '作曲', ...(instrumental ? [] : ['演唱'])].filter(role => !(after.people[role] ?? work.people[role])?.length) });
  if ((index + 1) % 20 === 0 || index + 1 === sourceMap.records.length) console.log(JSON.stringify({ processed: index + 1, total: sourceMap.records.length, errors: report.filter(r => r.metadata.errors.length).length }));
}
const summary = { versions: report.length, works: new Set(report.map(r => r.workId)).size, changedFiles: proposals.length,
  withLyricist: report.filter(r => !r.missing.includes('作词')).length, withComposer: report.filter(r => !r.missing.includes('作曲')).length,
  explicitSinger: report.filter(r => !r.instrumental && !r.missing.includes('演唱')).length,
  artistAttribution: report.filter(r => r.metadata.artists?.length).length, instrumentals: report.filter(r => r.instrumental).length,
  withErrors: report.filter(r => r.metadata.errors.length).length, withConflicts: report.filter(r => r.conflicts.length).length };
const outDir = path.join(root, 'outputs/song-metadata');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'netease-credits-report.json'), JSON.stringify({ source: sourceMap.source, sourceSha256: sourceMap.sourceSha256, summary, records: report }, null, 2) + '\n');
if (apply) {
  if (sha(await fs.readFile(path.join(root, sourceMap.source))) !== sourceMap.sourceSha256) throw new Error('Source changed during fetch');
  for (const entry of proposals) if (sha(await fs.readFile(entry.file)) !== entry.beforeHash) throw new Error(`File changed: ${entry.file}`);
  for (const entry of proposals) await fs.writeFile(entry.file, entry.output);
}
console.log(JSON.stringify({ ...summary, applied: apply }));
