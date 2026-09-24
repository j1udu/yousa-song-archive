import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = process.argv[2] ?? '.audio-cache/manifest.json';
const requestedRepo = process.argv.find(arg => arg.startsWith('--repo='))?.slice('--repo='.length);
const repo = requestedRepo ?? ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
const repository = ghJson(['repo', 'view', repo, '--json', 'nameWithOwner,visibility']);
const manifest = JSON.parse(await fs.readFile(path.join(root, manifestPath), 'utf8'));
const releaseByFormat = { flac: 'audio-flac-v1', mp3: 'audio-mp3-v1' };
const uploadConcurrency = Math.max(1, Number(process.env.AUDIO_UPLOAD_CONCURRENCY ?? 3));

if (manifest.summary?.errors) throw new Error(`下载清单仍有 ${manifest.summary.errors} 个错误，停止发布`);
if (repository.visibility !== 'PUBLIC' && !process.argv.includes('--allow-private')) {
  throw new Error(`${repository.nameWithOwner} 是私有仓库，Release 链接无法供公开网页访客下载。请改用公开仓库，或明确传入 --allow-private。`);
}
for (const record of manifest.records) {
  for (const asset of record.assets) {
    const localPath = path.resolve(root, asset.localPath);
    if (!localPath.startsWith(`${path.join(root, '.audio-cache')}${path.sep}`)) throw new Error(`音频不在缓存目录：${asset.localPath}`);
    if ((await fs.stat(localPath)).size !== asset.size) throw new Error(`本地文件大小不符：${asset.localPath}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(localPath)) hash.update(chunk);
    if (hash.digest('hex') !== asset.sha256) throw new Error(`本地文件 SHA-256 不符：${asset.localPath}`);
  }
}

for (const [format, tag] of Object.entries(releaseByFormat)) {
  const assets = manifest.records.flatMap(record => record.assets.filter(asset => asset.format === format));
  if (!assets.length) continue;
  ensureRelease(tag, format);
  const current = new Map((ghJson(['release', 'view', tag, '--repo', repo, '--json', 'assets']).assets ?? []).map(asset => [asset.name, asset]));
  const matches = (remote, local) => remote?.size === local.size && remote?.digest === `sha256:${local.sha256}`;
  const pending = assets.filter(asset => !matches(current.get(asset.fileName), asset));
  const batches = [];
  for (let index = 0; index < pending.length; index += 5) batches.push(pending.slice(index, index + 5));
  let cursor = 0;
  let uploaded = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(uploadConcurrency, batches.length) }, async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      try {
        await uploadBatch(tag, batch);
        uploaded += batch.length;
        console.log(JSON.stringify({ format, uploaded, total: pending.length }));
      } catch (error) {
        errors.push(error);
      }
    }
  }));
  if (errors.length) throw new AggregateError(errors, `${format} 上传失败，可重新执行以续传`);
  const uploadedAssets = new Map((ghJson(['release', 'view', tag, '--repo', repo, '--json', 'assets']).assets ?? []).map(asset => [asset.name, asset]));
  for (const asset of assets) {
    if (!matches(uploadedAssets.get(asset.fileName), asset)) throw new Error(`远端音频缺失或 SHA-256 不符：${asset.fileName}`);
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repository: repo,
  releases: releaseByFormat,
  records: manifest.records.map(record => ({
    workId: record.workId,
    versionId: record.versionId,
    songId: record.songId,
    versionFile: record.versionFile,
    assets: record.assets.map(asset => ({
      quality: asset.format === 'flac' ? 'FLAC 无损' : `MP3 ${Math.round((asset.bitrate ?? 0) / 1000)} kbps`,
      format: asset.format,
      size: asset.size,
      sha256: asset.sha256,
      url: `https://github.com/${repo}/releases/download/${releaseByFormat[asset.format]}/${asset.fileName}`,
    })),
  })),
};

for (const record of report.records) {
  const versionPath = path.join(root, record.versionFile);
  const version = JSON.parse(await fs.readFile(versionPath, 'utf8'));
  if (record.assets.length) {
    version.audio = record.assets;
    version.audioRights = 'authorized';
  } else {
    delete version.audio;
    delete version.audioRights;
  }
  await fs.writeFile(versionPath, `${JSON.stringify(version, null, 2)}\n`);
}

const reportPath = path.join(root, 'outputs/song-metadata/github-audio-assets.json');
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ repository: repo, versions: report.records.length, assets: report.records.reduce((sum, record) => sum + record.assets.length, 0), report: path.relative(root, reportPath) }));

function ensureRelease(tag, format) {
  const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' });
  if (existing.status === 0) return;
  runGh(['release', 'create', tag, '--repo', repo, '--title', format === 'flac' ? '泠鸢歌曲音频 FLAC v1' : '泠鸢歌曲音频 MP3 v1', '--notes', '经授权收录的歌曲音频。文件由曲库清单自动维护，请通过歌曲资料站选择对应版本下载。']);
}

function ghJson(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `gh ${args.join(' ')} failed`);
  return JSON.parse(result.stdout);
}

function runGh(args) {
  const result = spawnSync('gh', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed`);
}

function uploadBatch(tag, assets) {
  return new Promise((resolve, reject) => {
    const paths = assets.map(asset => path.join(root, asset.localPath));
    const child = spawn('gh', ['release', 'upload', tag, ...paths, '--repo', repo, '--clobber'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`上传 ${tag} 中的 ${assets[0].fileName} 等文件失败（${code}）`)));
  });
}
