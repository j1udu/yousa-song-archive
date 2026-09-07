import { ContentRequestError, loadLyrics, loadTagCatalog, loadVersion, loadWork, loadWorkIndex } from "./api";
import { mergePeople, type TagCatalog, type Version, type Work, type WorkIndex } from "./types";

export interface CatalogData {
  index: WorkIndex;
  tags: TagCatalog;
}

let catalogPromise: Promise<CatalogData> | null = null;
const workCache = new Map<string, Promise<Work>>();
const versionCache = new Map<string, Promise<Version>>();
const lyricsCache = new Map<string, Promise<string>>();

/** 索引和标签目录整站只加载一次；失败后清空缓存，允许重试。 */
export function loadCatalog(): Promise<CatalogData> {
  if (!catalogPromise) {
    catalogPromise = Promise.all([loadWorkIndex(), loadTagCatalog()]).then(([index, tags]) => {
      if (!index || !Array.isArray(index.works)) throw new Error("作品索引格式不正确");
      if (!tags || !Array.isArray(tags.groups)) throw new Error("标签配置格式不正确");
      return { index, tags };
    });
    catalogPromise.catch(() => {
      catalogPromise = null;
    });
  }
  return catalogPromise;
}

export function getWork(workId: string): Promise<Work> {
  return cached(workCache, workId, () => loadWork(workId));
}

export function getVersion(workId: string, versionId: string): Promise<Version> {
  return cached(versionCache, `${workId}/${versionId}`, () => loadVersion(workId, versionId));
}

export function getLyrics(url: string): Promise<string> {
  return cached(lyricsCache, url, () => loadLyrics(url));
}

export interface VersionPeople {
  /** 作品 ID → 该作品所有版本继承/替换/新增后的最终人员姓名（去重）。 */
  people: Map<string, string[]>;
  /** 有版本文件读取失败时为 false，下次再有需要时会重试。 */
  complete: boolean;
}

let versionPeoplePromise: Promise<VersionPeople> | null = null;
const VERSION_FETCH_CONCURRENCY = 6;

/**
 * 首页搜索需要版本层人员，但索引里的版本只是摘要；这里按需并发读取全部版本详情并整站缓存。
 * 只有在用户表现出搜索意图（聚焦搜索框或查询词非空）时才会调用，浏览不触发。
 */
export function loadVersionPeople(index: WorkIndex): Promise<VersionPeople> {
  if (!versionPeoplePromise) {
    versionPeoplePromise = collectVersionPeople(index).then((result) => {
      if (!result.complete) versionPeoplePromise = null;
      return result;
    });
  }
  return versionPeoplePromise;
}

async function collectVersionPeople(index: WorkIndex): Promise<VersionPeople> {
  const tasks = index.works.flatMap((work) => work.versions.map((version) => ({ work, versionId: version.id })));
  const names = new Map<string, Set<string>>();
  let complete = true;
  await runLimited(tasks, VERSION_FETCH_CONCURRENCY, async ({ work, versionId }) => {
    try {
      const version = await getVersion(work.id, versionId);
      const set = names.get(work.id) ?? new Set<string>();
      for (const list of Object.values(mergePeople(work.people, version.people))) for (const name of list) set.add(name);
      names.set(work.id, set);
    } catch {
      complete = false;
    }
  });
  return { people: new Map([...names].map(([id, set]) => [id, [...set]])), complete };
}

async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await task(item);
    }
  });
  await Promise.all(workers);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ContentRequestError && error.status === 404;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ContentRequestError) return error.message;
  if (error instanceof TypeError) return "网络连接失败，请检查网络后重试。";
  if (error instanceof SyntaxError) return "内容格式不正确，无法解析。";
  if (error instanceof Error) return error.message;
  return "未知错误";
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing) return existing;
  const promise = load();
  cache.set(key, promise);
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}
