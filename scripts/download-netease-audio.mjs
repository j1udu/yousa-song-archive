import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const root = process.cwd();
const sourceMapPath = process.argv[2] ?? 'outputs/song-metadata/netease-source-map.json';
const cacheDir = path.join(root, '.audio-cache');
const manifestPath = path.join(cacheDir, 'manifest.json');
const endpoint = '/api/song/enhance/player/url/v1';
const concurrency = Math.max(1, Number(process.env.AUDIO_DOWNLOAD_CONCURRENCY ?? 3));

const env = await fsp.readFile(path.join(root, '.env.local'), 'utf8');
const musicU = env.match(/^NETEASE_MUSIC_U=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!musicU) throw new Error('NETEASE_MUSIC_U is missing from .env.local');

const sourceMap = JSON.parse(await fsp.readFile(path.join(root, sourceMapPath), 'utf8'));
const previous = await readJson(manifestPath, { schemaVersion: 1, records: [] });
const previousByKey = new Map(previous.records.map(record => [`${record.workId}/${record.versionId}`, record]));
const records = [];
const queue = [...sourceMap.records];
let completed = 0;
let manifestWrite = Promise.resolve();

await fsp.mkdir(path.join(cacheDir, 'flac'), { recursive: true });
await fsp.mkdir(path.join(cacheDir, 'mp3'), { recursive: true });

function encrypt(payload) {
  const json = JSON.stringify(payload);
  const digest = crypto.createHash('md5').update(`nobody${endpoint}use${json}md5forencrypt`).digest('hex');
  const plaintext = `${endpoint}-36cd479b6b5-${json}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('hex').toUpperCase();
}

async function requestUrl(songId, level, encodeType) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const params = encrypt({ ids: `[${songId}]`, level, encodeType, immerseType: 'c51' });
      const response = await fetch('https://interface3.music.163.com/eapi/song/enhance/player/url/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `MUSIC_U=${musicU}; os=pc; appver=9.1.40`,
          Referer: 'https://music.163.com/',
          'User-Agent': 'NeteaseMusic/9.1.40.250925161740',
        },
        body: new URLSearchParams({ params }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const item = payload.data?.[0];
      if (payload.code !== 200 || !item) throw new Error(`NetEase returned ${payload.code}`);
      return item.code === 200 && item.url && !item.freeTrialInfo ? item : null;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(attempt * 1000);
    }
  }
  throw new Error(`无法获取歌曲 ${songId} 的 ${level} 地址：${lastError?.message ?? '未知错误'}`);
}

async function existingAsset(record, format) {
  const asset = record?.assets?.find(item => item.format === format);
  if (!asset) return null;
  const absolute = path.join(root, asset.localPath);
  try {
    const stat = await fsp.stat(absolute);
    if (stat.size !== asset.size || !asset.sha256) return null;
    return asset;
  } catch {
    return null;
  }
}

async function downloadAsset(item, workId, versionId, format) {
  const fileName = `${workId}-${versionId}.${format}`;
  const relative = path.posix.join('.audio-cache', format, fileName);
  const destination = path.join(root, relative);
  const partial = `${destination}.part`;
  const expectedSize = Number(item.size) || null;
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      let offset = 0;
      try { offset = (await fsp.stat(partial)).size; } catch { /* first attempt */ }
      if (expectedSize && offset > expectedSize) {
        await fsp.rm(partial, { force: true });
        offset = 0;
      }
      const headers = {
        Referer: 'https://music.163.com/',
        'User-Agent': 'NeteaseMusic/9.1.40.250925161740',
      };
      if (offset) headers.Range = `bytes=${offset}-`;
      const response = await fetch(item.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
      if (!(response.ok || response.status === 206) || !response.body) throw new Error(`音频 HTTP ${response.status}`);
      const append = offset > 0 && response.status === 206;
      if (!append) offset = 0;
      await pipeline(response.body, fs.createWriteStream(partial, { flags: append ? 'a' : 'w' }));
      const stat = await fsp.stat(partial);
      if (expectedSize && stat.size !== expectedSize) throw new Error(`文件大小不符：${stat.size}/${expectedSize}`);
      await verifyMagic(partial, format);
      await fsp.rename(partial, destination);
      return {
        format,
        bitrate: Number(item.br) || null,
        size: stat.size,
        sha256: await sha256(destination),
        localPath: relative,
        fileName,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(attempt * 1500);
    }
  }
  throw new Error(`${fileName} 下载失败：${lastError?.message ?? '未知错误'}`);
}

async function processRecord(source) {
  const key = `${source.workId}/${source.versionId}`;
  const old = previousByKey.get(key);
  const flacExisting = await existingAsset(old, 'flac');
  const mp3Existing = await existingAsset(old, 'mp3');
  const assets = [];

  if (flacExisting) assets.push(flacExisting);
  if (mp3Existing) assets.push(mp3Existing);
  if (!flacExisting || !mp3Existing) {
    // 网易云接口会偶发关闭同一歌曲的并行请求，顺序取地址更稳定。
    const lossless = flacExisting ? null : await requestUrl(source.songId, 'lossless', 'flac');
    const mp3 = mp3Existing ? null : await requestUrl(source.songId, 'exhigh', 'mp3');
    if (!flacExisting && lossless?.type === 'flac') assets.push(await downloadAsset(lossless, source.workId, source.versionId, 'flac'));
    const mp3Source = mp3?.type === 'mp3' ? mp3 : lossless?.type === 'mp3' ? lossless : null;
    if (!mp3Existing && mp3Source) assets.push(await downloadAsset(mp3Source, source.workId, source.versionId, 'mp3'));
  }

  return {
    workId: source.workId,
    versionId: source.versionId,
    songId: String(source.songId),
    title: source.reviewTitle,
    versionFile: source.file,
    assets: assets.sort((a, b) => (a.format === 'flac' ? -1 : b.format === 'flac' ? 1 : 0)),
  };
}

async function worker() {
  while (queue.length) {
    const source = queue.shift();
    if (!source) return;
    try {
      records.push(await processRecord(source));
    } catch (error) {
      records.push({ workId: source.workId, versionId: source.versionId, songId: String(source.songId), title: source.reviewTitle, versionFile: source.file, assets: [], error: error.message });
    }
    completed += 1;
    if (completed % 5 === 0 || completed === sourceMap.records.length) {
      await saveManifest();
      const assets = records.reduce((count, record) => count + record.assets.length, 0);
      const errors = records.filter(record => record.error).length;
      console.log(JSON.stringify({ processed: completed, total: sourceMap.records.length, assets, errors }));
    }
  }
}

async function writeManifest() {
  const ordered = [...records].sort((a, b) => sourceMap.records.findIndex(item => item.workId === a.workId && item.versionId === a.versionId) - sourceMap.records.findIndex(item => item.workId === b.workId && item.versionId === b.versionId));
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceMap: sourceMapPath,
    summary: {
      versions: ordered.length,
      assets: ordered.reduce((count, record) => count + record.assets.length, 0),
      bytes: ordered.flatMap(record => record.assets).reduce((sum, asset) => sum + asset.size, 0),
      errors: ordered.filter(record => record.error).length,
    },
    records: ordered,
  };
  const temp = `${manifestPath}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(output, null, 2)}\n`);
  await fsp.rename(temp, manifestPath);
}

function saveManifest() {
  manifestWrite = manifestWrite.then(writeManifest);
  return manifestWrite;
}

async function verifyMagic(file, format) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(4);
    await handle.read(buffer, 0, 4, 0);
    const valid = format === 'flac'
      ? buffer.toString('ascii') === 'fLaC'
      : buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    if (!valid) throw new Error(`${format} 文件头无效`);
  } finally {
    await handle.close();
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

await Promise.all(Array.from({ length: concurrency }, () => worker()));
await saveManifest();
const final = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
console.log(JSON.stringify(final.summary));
if (final.summary.errors) process.exitCode = 1;
