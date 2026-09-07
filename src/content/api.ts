import type { TagCatalog, Version, Work, WorkIndex } from "./types";

/** 内容请求失败时抛出的错误，附带 HTTP 状态码，便于页面区分“不存在”和“加载失败”。 */
export class ContentRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ContentRequestError";
  }
}

export async function loadWorkIndex(): Promise<WorkIndex> {
  return fetchJson<WorkIndex>("content/works-index.json");
}

export async function loadTagCatalog(): Promise<TagCatalog> {
  return fetchJson<TagCatalog>("content/tags.json");
}

export async function loadWork(workId: string): Promise<Work> {
  return fetchJson<Work>(`content/works/${encodeURIComponent(workId)}/work.json`);
}

export async function loadVersion(workId: string, versionId: string): Promise<Version> {
  return fetchJson<Version>(`content/works/${encodeURIComponent(workId)}/version-${encodeURIComponent(versionId)}.json`);
}

export async function loadLyrics(path: string): Promise<string> {
  const response = await fetch(contentUrl(path));
  if (!response.ok) throw new ContentRequestError(`歌词请求失败（${response.status}）：${path}`, response.status, path);
  assertNotHtmlFallback(response, path);
  return response.text();
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(contentUrl(path));
  if (!response.ok) throw new ContentRequestError(`内容请求失败（${response.status}）：${path}`, response.status, path);
  assertNotHtmlFallback(response, path);
  return (await response.json()) as T;
}

/**
 * 带 SPA 回退的静态服务器（vite preview、部分托管平台）会对缺失文件返回 200 的 index.html；
 * GitHub Pages 则返回真正的 404。这里把 HTML 响应统一视为资源不存在，两种环境下页面状态一致。
 */
function assertNotHtmlFallback(response: Response, path: string): void {
  const type = response.headers.get("content-type") ?? "";
  if (/text\/html/i.test(type)) throw new ContentRequestError(`内容不存在（404）：${path}`, 404, path);
}

export function contentUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path.replace(/^\//, "")}`;
}
