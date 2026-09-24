import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AudioAsset, IndexedWork, RoleMap, TagCatalog, Version, VersionSummary, Work, WorkIndex } from "../src/content/types";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^(?:\d{4}|\d{4}-\d{2}-\d{2})$/;
const CONTENT_ROOT = "public/content";

export class ContentValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("\n"));
    this.name = "ContentValidationError";
  }
}

export function contentPaths(root: string): { content: string; works: string; tags: string; index: string } {
  const content = resolve(root, CONTENT_ROOT);
  return { content, works: join(content, "works"), tags: join(content, "tags.json"), index: join(content, "works-index.json") };
}

export function buildWorkIndex(root: string): { index: WorkIndex; tags: TagCatalog } {
  const paths = contentPaths(root);
  const issues: string[] = [];
  const tagsValue = readJson(paths.tags, issues, "public/content/tags.json");
  const tags = tagsValue as TagCatalog | null;
  const tagIds = validateTags(tagsValue, issues);
  const works: IndexedWork[] = [];

  if (!existsSync(paths.works)) {
    issues.push("public/content/works: 目录不存在");
  } else {
    for (const entry of readdirSync(paths.works, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const workDir = join(paths.works, entry.name);
      const workFile = join(workDir, "work.json");
      const workValue = readJson(workFile, issues, relative(root, workFile));
      if (!isRecord(workValue)) continue;
      const work = workValue as Work;
      validateWork(work, entry.name, workDir, root, tagIds, issues);

      const versions = new Map<string, { value: Version; summary: VersionSummary }>();
      for (const fileName of readdirSync(workDir)) {
        if (!fileName.startsWith("version-") || !fileName.endsWith(".json")) continue;
        if (!/^version-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(fileName)) {
          issues.push(`${relative(root, join(workDir, fileName))}: 版本文件名必须使用 version-{version-id}.json`);
          continue;
        }
        const versionFile = join(workDir, fileName);
        const versionValue = readJson(versionFile, issues, relative(root, versionFile));
        if (!isRecord(versionValue)) continue;
        const version = versionValue as Version;
        validateVersion(version, fileName, relative(root, versionFile), workDir, issues);
        if (versions.has(version.id)) issues.push(`${relative(root, versionFile)}: 版本 ID 重复：${version.id}`);
        const path = toPublicPath(root, versionFile);
        versions.set(version.id, { value: version, summary: { id: version.id, name: version.name, type: version.type, date: version.date, path } });
      }

      const versionOrder = Array.isArray(work.versionOrder) ? work.versionOrder : [];
      validateVersionOrder(work, versionOrder, versions, issues);
      const orderedVersions = versionOrder.map((id) => versions.get(id)?.summary).filter((version): version is VersionSummary => Boolean(version));
      works.push({
        ...work,
        path: toPublicPath(root, workFile),
        coverUrl: typeof work.cover === "string" ? toPublicPath(root, join(workDir, work.cover)) : null,
        lyricsUrl: typeof work.lyrics === "string" ? toPublicPath(root, join(workDir, work.lyrics)) : null,
        versions: orderedVersions,
      });
    }
  }

  if (issues.length) throw new ContentValidationError(issues);
  works.sort((a, b) => a.id.localeCompare(b.id));
  return { index: { schemaVersion: 1, works }, tags: tags as TagCatalog };
}

export function writeWorkIndex(root: string): WorkIndex {
  const paths = contentPaths(root);
  const { index } = buildWorkIndex(root);
  writeFileSync(paths.index, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

function readJson(file: string, issues: string[], label: string): unknown {
  if (!existsSync(file)) { issues.push(`${label}: 文件不存在`); return null; }
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { issues.push(`${label}: JSON 无法解析（${error instanceof Error ? error.message : "未知错误"}）`); return null; }
}

function validateTags(value: unknown, issues: string[]): Set<string> {
  const ids = new Set<string>();
  const groupIds = new Set<string>();
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.groups)) { issues.push("public/content/tags.json: 必须包含 schemaVersion=1 和 groups 数组"); return ids; }
  for (const [groupIndex, group] of value.groups.entries()) {
    const label = `public/content/tags.json groups[${groupIndex}]`;
    if (!isRecord(group) || !isNonEmptyString(group.id) || !isNonEmptyString(group.name) || typeof group.order !== "number" || !Array.isArray(group.tags)) { issues.push(`${label}: 必须包含 id、name、order、tags`); continue; }
    if (groupIds.has(group.id)) issues.push(`${label}: 分组 ID 重复：${group.id}`);
    groupIds.add(group.id);
    for (const [tagIndex, tag] of group.tags.entries()) {
      if (!isRecord(tag) || !isNonEmptyString(tag.id) || !isNonEmptyString(tag.name) || typeof tag.order !== "number") { issues.push(`${label}.tags[${tagIndex}]: 必须包含 id、name、order`); continue; }
      if (ids.has(tag.id)) issues.push(`${label}.tags[${tagIndex}]: 标签 ID 重复：${tag.id}`);
      ids.add(tag.id);
    }
  }
  return ids;
}

function validateWork(work: Work, dirName: string, workDir: string, root: string, tagIds: Set<string>, issues: string[]): void {
  const label = `public/content/works/${dirName}/work.json`;
  if (work.schemaVersion !== 1) issues.push(`${label}: schemaVersion 必须为 1`);
  if (work.id !== dirName || !ID_PATTERN.test(work.id)) issues.push(`${label}: id 必须与目录名一致，且只使用小写英文、数字和连字符`);
  if (!isNonEmptyString(work.title)) issues.push(`${label}: title 必须是非空字符串`);
  if (!Array.isArray(work.aliases) || !work.aliases.every(isNonEmptyString)) issues.push(`${label}: aliases 必须是字符串数组`);
  if (!(work.year === null || (Number.isInteger(work.year) && work.year >= 1000 && work.year <= 9999))) issues.push(`${label}: year 必须是四位年份或 null`);
  if (!Array.isArray(work.tags) || !work.tags.every(isNonEmptyString)) issues.push(`${label}: tags 必须是标签 ID 数组`);
  for (const tagId of Array.isArray(work.tags) ? work.tags : []) if (!tagIds.has(tagId)) issues.push(`${label}: 标签 ID 不存在：${tagId}`);
  validateRoleMap(work.people, `${label}: people`, issues);
  validateLocalResource(work.cover, workDir, `${label}: cover`, [".webp", ".jpg", ".jpeg", ".png"], issues);
  validateLocalResource(work.lyrics, workDir, `${label}: lyrics`, [".txt"], issues);
  if (typeof work.summary !== "string") issues.push(`${label}: summary 必须是字符串`);
  if (!Array.isArray(work.versionOrder) || !work.versionOrder.every(isNonEmptyString)) issues.push(`${label}: versionOrder 必须是版本 ID 数组`);
  if (!Array.isArray(work.featuredVersions) || !work.featuredVersions.every(isNonEmptyString)) issues.push(`${label}: featuredVersions 必须是版本 ID 数组`);
  if ((Array.isArray(work.featuredVersions) ? work.featuredVersions.length : 0) > 3) issues.push(`${label}: featuredVersions 最多 3 个`);
  checkDuplicates(work.tags, `${label}: tags`, issues);
  checkDuplicates(work.versionOrder, `${label}: versionOrder`, issues);
  checkDuplicates(work.featuredVersions, `${label}: featuredVersions`, issues);
}

function validateVersion(version: Version, fileName: string, label: string, workDir: string, issues: string[]): void {
  const expectedId = fileName.slice("version-".length, -".json".length);
  if (version.schemaVersion !== 1) issues.push(`${label}: schemaVersion 必须为 1`);
  if (version.id !== expectedId || !ID_PATTERN.test(version.id)) issues.push(`${label}: id 必须与文件名一致，且只使用小写英文、数字和连字符`);
  if (!isNonEmptyString(version.name)) issues.push(`${label}: name 必须是非空字符串`);
  if (!isNonEmptyString(version.type)) issues.push(`${label}: type 必须是非空字符串`);
  if (!(version.date === null || (typeof version.date === "string" && DATE_PATTERN.test(version.date) && isValidDate(version.date)))) issues.push(`${label}: date 必须是 YYYY 或有效的 YYYY-MM-DD，或 null`);
  validateRoleMap(version.people, `${label}: people`, issues);
  if (!Array.isArray(version.links)) issues.push(`${label}: links 必须是数组`);
  else for (const [index, link] of version.links.entries()) validateLink(link, `${label}: links[${index}]`, issues);
  const audio = (version as Version & { audio?: unknown }).audio;
  if (audio === undefined) {
    // 兼容早期没有音频字段的版本文件。
  } else if (!Array.isArray(audio)) issues.push(`${label}: audio 必须是数组`);
  else {
    const qualities = new Set<string>();
    for (const [index, asset] of audio.entries()) {
      const item = asset as Partial<AudioAsset>;
      const hasFile = isNonEmptyString(item.file);
      const hasUrl = isNonEmptyString(item.url);
      if (!isNonEmptyString(item.quality) || (!hasFile && !hasUrl) || !["mp3", "flac"].includes(String(item.format))) issues.push(`${label}: audio[${index}] 必须包含 quality、format，以及 file 或 url`);
      if (isNonEmptyString(item.quality) && qualities.has(item.quality)) issues.push(`${label}: audio 音质不能重复：${item.quality}`);
      if (isNonEmptyString(item.quality)) qualities.add(item.quality);
      if (hasFile) validateLocalResource(item.file!, workDir, `${label}: audio[${index}].file`, [".mp3", ".flac"], issues);
      if (hasFile && (item.format === "mp3" || item.format === "flac") && !item.file!.toLowerCase().endsWith(`.${item.format}`)) issues.push(`${label}: audio[${index}].file 扩展名必须与 format 一致`);
      if (hasUrl && !/^https:\/\/[^\s]+$/i.test(item.url!)) issues.push(`${label}: audio[${index}].url 必须是 HTTPS URL`);
      if (item.size !== undefined && (!Number.isInteger(item.size) || item.size <= 0)) issues.push(`${label}: audio[${index}].size 必须是正整数`);
      if (item.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(item.sha256)) issues.push(`${label}: audio[${index}].sha256 必须是 64 位十六进制摘要`);
    }
  }
  const rights = (version as Version & { audioRights?: unknown }).audioRights;
  if (rights !== undefined && rights !== null && rights !== "authorized") issues.push(`${label}: audioRights 只能是 authorized 或 null`);
  if (Array.isArray(audio) && audio.length && rights !== "authorized") issues.push(`${label}: 收录音频时必须确认拥有分发权`);
  if (typeof version.notes !== "string") issues.push(`${label}: notes 必须是字符串`);
}


function validateVersionOrder(work: Work, order: string[], versions: Map<string, { value: Version; summary: VersionSummary }>, issues: string[]): void {
  const label = `public/content/works/${work.id}/work.json`;
  const ids = new Set(versions.keys());
  for (const id of order) if (!ids.has(id)) issues.push(`${label}: versionOrder 引用了不存在的版本：${id}`);
  for (const id of ids) if (!order.includes(id)) issues.push(`${label}: versionOrder 缺少版本：${id}`);
  for (const id of Array.isArray(work.featuredVersions) ? work.featuredVersions : []) if (!ids.has(id)) issues.push(`${label}: featuredVersions 引用了不存在的版本：${id}`);
}

function validateRoleMap(value: RoleMap, label: string, issues: string[]): void {
  if (!isRecord(value)) { issues.push(`${label} 必须是角色到人员数组的映射`); return; }
  for (const [role, people] of Object.entries(value)) if (!role.trim() || !Array.isArray(people) || !people.every(isNonEmptyString)) issues.push(`${label}.${role}: 必须是非空字符串数组`);
}

function validateLink(value: unknown, label: string, issues: string[]): void {
  if (!isRecord(value) || !isNonEmptyString(value.platform) || !isNonEmptyString(value.label) || !isNonEmptyString(value.url)) { issues.push(`${label}: 必须包含 platform、url、label`); return; }
  if (!/^https?:\/\/[^\s]+$/i.test(value.url)) issues.push(`${label}: url 必须是 http(s) URL`);
}

function validateLocalResource(value: unknown, workDir: string, label: string, extensions: string[], issues: string[]): void {
  if (value === null) return;
  if (!isNonEmptyString(value) || value.includes("..") || value.includes("\\") || value.startsWith("/") || !extensions.some((extension) => value.toLowerCase().endsWith(extension))) { issues.push(`${label}: 必须是作品目录内的资源文件`); return; }
  if (!existsSync(join(workDir, value))) issues.push(`${label}: 文件不存在：${value}`);
}

function toPublicPath(root: string, file: string): string { return relative(resolve(root, "public"), file).split("\\").join("/"); }
function checkDuplicates(values: unknown, label: string, issues: string[]): void { if (Array.isArray(values) && new Set(values).size !== values.length) issues.push(`${label} 不应包含重复 ID`); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isValidDate(value: string): boolean { if (value.length === 4) return true; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value; }
