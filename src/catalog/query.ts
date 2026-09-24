import type { IndexedWork, Tag, TagCatalog, TagGroup, VersionSummary } from "../content/types";

export const PAGE_SIZE = 24;
export const MAX_FEATURED = 3;

export type SortKey = "year-desc" | "year-asc" | "title-asc" | "title-desc";

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "year-desc", label: "年份：新到旧" },
  { value: "year-asc", label: "年份：旧到新" },
  { value: "title-asc", label: "标题：A 到 Z" },
  { value: "title-desc", label: "标题：Z 到 A" },
];

export const DEFAULT_SORT: SortKey = "year-desc";

export interface CatalogQuery {
  q: string;
  year: string;
  tags: string[];
  sort: SortKey;
  page: number;
}

export const EMPTY_QUERY: Readonly<CatalogQuery> = { q: "", year: "", tags: [], sort: DEFAULT_SORT, page: 1 };

export interface TagInfo {
  tag: Tag;
  group: TagGroup;
  groupIndex: number;
}

export interface TagLookup {
  /** 分组和标签均已按配置的 order 排序。 */
  groups: TagGroup[];
  byId: Map<string, TagInfo>;
}

function byOrder(a: { order: number }, b: { order: number }): number {
  return a.order - b.order;
}

export function buildTagLookup(catalog: TagCatalog): TagLookup {
  const groups = [...catalog.groups].sort(byOrder).map((group) => ({ ...group, tags: [...group.tags].sort(byOrder) }));
  const byId = new Map<string, TagInfo>();
  groups.forEach((group, groupIndex) => {
    for (const tag of group.tags) if (!byId.has(tag.id)) byId.set(tag.id, { tag, group, groupIndex });
  });
  return { groups, byId };
}

export function isSortKey(value: string | null): value is SortKey {
  return SORT_OPTIONS.some((option) => option.value === value);
}

export function parseQuery(params: URLSearchParams, lookup: TagLookup): CatalogQuery {
  const q = (params.get("q") ?? "").slice(0, 200);
  const yearRaw = params.get("year") ?? "";
  const year = /^\d{4}$/.test(yearRaw) ? yearRaw : "";
  const tags = unique(params.getAll("tag").filter((id) => lookup.byId.has(id)));
  const sortRaw = params.get("sort");
  const sort = isSortKey(sortRaw) ? sortRaw : DEFAULT_SORT;
  const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  return { q, year, tags, sort, page };
}

export function serializeQuery(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q);
  if (query.year) params.set("year", query.year);
  for (const tag of query.tags) params.append("tag", tag);
  if (query.sort !== DEFAULT_SORT) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

export function hasFilters(query: CatalogQuery): boolean {
  return Boolean(query.q.trim() || query.year || query.tags.length);
}

export function sameQuery(a: CatalogQuery, b: CatalogQuery): boolean {
  return serializeQuery(a) === serializeQuery(b) && a.q === b.q;
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

export function searchTerms(q: string): string[] {
  const normalized = normalizeText(q);
  return normalized ? normalized.split(" ") : [];
}

/** 搜索范围：标题、别名、作品人员姓名、版本名称，以及按需加载的版本层人员（extra）。 */
export function searchFields(work: IndexedWork, extra: readonly string[] = []): string[] {
  return [work.title, ...work.aliases, ...Object.values(work.people).flat(), ...work.versions.map((version) => version.name), ...extra].map(normalizeText);
}

export function matchesTerms(fields: string[], terms: string[]): boolean {
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/** 把选中的标签按分组归类；不在目录中的标签忽略。 */
export function groupSelectedTags(selected: string[], lookup: TagLookup): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const id of selected) {
    const info = lookup.byId.get(id);
    if (!info) continue;
    const set = groups.get(info.group.id) ?? new Set<string>();
    set.add(id);
    groups.set(info.group.id, set);
  }
  return groups;
}

/** 组内任意标签满足即可，组间必须同时满足。 */
export function matchesTagGroups(work: IndexedWork, groups: Map<string, Set<string>>): boolean {
  for (const ids of groups.values()) if (!work.tags.some((tag) => ids.has(tag))) return false;
  return true;
}

export function matchesYear(work: IndexedWork, year: string): boolean {
  return !year || String(work.year ?? "") === year;
}

export interface ApplyOptions {
  /** 作品 ID → 版本层最终人员姓名；未加载时省略，搜索只覆盖作品层字段。 */
  versionPeople?: ReadonlyMap<string, readonly string[]>;
}

export function applyQuery(works: IndexedWork[], query: CatalogQuery, lookup: TagLookup, options: ApplyOptions = {}): IndexedWork[] {
  const terms = searchTerms(query.q);
  const groups = groupSelectedTags(query.tags, lookup);
  const filtered = works.filter(
    (work) =>
      matchesYear(work, query.year) &&
      matchesTagGroups(work, groups) &&
      (terms.length === 0 || matchesTerms(searchFields(work, options.versionPeople?.get(work.id) ?? []), terms)),
  );
  return sortWorks(filtered, query.sort);
}

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

/** 拉丁字母、数字等开头的标题排在前面（A→Z），汉字开头的标题按拼音排在后面。 */
function titleClass(title: string): number {
  return /^\p{Script=Han}/u.test(title.trim()) ? 1 : 0;
}

function compareTitle(a: IndexedWork, b: IndexedWork): number {
  return titleClass(a.title) - titleClass(b.title) || collator.compare(a.title, b.title) || a.id.localeCompare(b.id);
}

/** 年份未知的作品在两种年份排序下都排在最后。 */
function compareYear(a: IndexedWork, b: IndexedWork, direction: "asc" | "desc"): number {
  if (a.year === b.year) return 0;
  if (a.year === null) return 1;
  if (b.year === null) return -1;
  return direction === "desc" ? b.year - a.year : a.year - b.year;
}

export function sortWorks(works: IndexedWork[], sort: SortKey): IndexedWork[] {
  const sorted = [...works];
  switch (sort) {
    case "year-asc":
      return sorted.sort((a, b) => compareYear(a, b, "asc") || compareTitle(a, b));
    case "title-asc":
      return sorted.sort(compareTitle);
    case "title-desc":
      return sorted.sort((a, b) => compareTitle(b, a));
    default:
      return sorted.sort((a, b) => compareYear(a, b, "desc") || compareTitle(a, b));
  }
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

export function paginate<T>(items: T[], page: number, size: number = PAGE_SIZE): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages, total };
}

/** 页码窗口：始终包含首尾页和当前页前后各一页，中间用 gap 省略。 */
export function pageWindow(current: number, pages: number): Array<number | "gap"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const numbers = new Set<number>([1, pages, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => numbers.add(n));
  if (current >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => numbers.add(n));
  const sorted = [...numbers].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((n, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && n - previous > 1) result.push("gap");
    result.push(n);
  });
  return result;
}

export function availableYears(works: IndexedWork[]): number[] {
  const years = new Set<number>();
  for (const work of works) if (work.year !== null) years.add(work.year);
  return [...years].sort((a, b) => b - a);
}

/** 版本摘要严格按 versionOrder 排列；索引中多出的版本追加在最后。 */
export function orderedVersions(work: IndexedWork): VersionSummary[] {
  const byId = new Map(work.versions.map((version) => [version.id, version]));
  const ordered: VersionSummary[] = [];
  for (const id of work.versionOrder) {
    const version = byId.get(id);
    if (version) {
      ordered.push(version);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}

/** 卡片上的版本：优先 featuredVersions（最多 3 个），为空时取 versionOrder 前 3 个。 */
export function cardVersions(work: IndexedWork): { shown: VersionSummary[]; all: VersionSummary[] } {
  const all = orderedVersions(work);
  const byId = new Map(all.map((version) => [version.id, version]));
  const featured = work.featuredVersions.map((id) => byId.get(id)).filter((version): version is VersionSummary => Boolean(version));
  const shown = (featured.length ? featured : all).slice(0, MAX_FEATURED);
  return { shown, all };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
