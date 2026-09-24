import type { RoleMap } from "../content/types";
import { contentUrl } from "../content/api";
import type { TagLookup } from "../catalog/query";
import { BRAND_IMAGES } from "../site";
import { html, type Raw } from "./html";
import { icon } from "./icons";
import { homeHref } from "../router";

export const SITE_NAME = "泠鸢yousa 歌曲资料库";

/** 分组配色：按分组顺序循环取色相，卡片和筛选面板共用。 */
const GROUP_HUES = [196, 24, 268, 152, 336, 44];

export function groupHue(groupIndex: number): number {
  return GROUP_HUES[groupIndex % GROUP_HUES.length] ?? GROUP_HUES[0]!;
}

/** 维护占位值，公开页面不展示（见 CONTEXT.md“资料纳入”）。 */
const PLACEHOLDER_VALUES = new Set(["", "待补充"]);

export function displayType(type: string): string {
  const value = type.trim();
  return PLACEHOLDER_VALUES.has(value) ? "" : value;
}

export function siteHeader(options: { search?: string; back?: boolean } = {}): Raw {
  const mark = BRAND_IMAGES.avatar
    ? html`<img class="brand__mark brand__mark--image" src="${contentUrl(BRAND_IMAGES.avatar)}" alt="" />`
    : html`<span class="brand__mark" aria-hidden="true">鸢</span>`;
  const home = homeHref(options.search ?? "");
  return html`<header class="site-header">
    <div class="site-header__inner">
      <p class="brand-wrap"><a class="brand" href="${home}">${mark}<span class="brand__name">泠鸢yousa</span><span class="brand__sub">歌曲资料库</span></a></p>
      ${options.back
        ? html`<nav class="site-header__nav" aria-label="返回"><a class="back-link" href="${home}">${icon("arrow-left")}<span>返回曲库</span></a></nav>`
        : html`<p class="site-header__note">非官方 · 粉丝整理</p>`}
    </div>
  </header>`;
}

export function siteFooter(): Raw {
  return html`<footer class="site-footer">
    <div class="site-footer__inner">
      <p class="site-footer__mark" aria-hidden="true">鸢</p>
      <div>
        <p>本站为粉丝整理的非官方资料站，与泠鸢yousa本人及所属团队无关。</p>
        <p>作品信息与歌词的版权归原作者及相关权利人所有。</p>
      </div>
    </div>
  </footer>`;
}

/* --------------------------------------------------------------------------
   封面：有图用图，没有图时用“字符封面”——取标题首字，配一组传统色。
   -------------------------------------------------------------------------- */

/** 传统色：[底色, 字色]。按作品 ID 哈希取用，同一作品在各页面颜色一致。 */
const GLYPH_TONES: ReadonlyArray<readonly [string, string]> = [
  ["#dce8ee", "#2f5467"], // 月白
  ["#d3e6e1", "#245e58"], // 天青
  ["#ecdbe2", "#76455a"], // 藕荷
  ["#f1e5ca", "#77561f"], // 缃色
  ["#dde8d4", "#415e37"], // 竹青
  ["#e0dcec", "#51467a"], // 丁香
  ["#f0dad3", "#853d31"], // 霁红
  ["#e2e1da", "#3c4146"], // 烟墨
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

/** 标题中第一个汉字/字母/数字；拉丁字母转大写。 */
export function titleGlyph(title: string): string {
  const found = [...title.normalize("NFKC").trim()].find((char) => /[\p{Script=Han}\p{L}\p{N}]/u.test(char));
  if (!found) return "♪";
  return /\p{Script=Han}/u.test(found) ? found : found.toLocaleUpperCase();
}

export interface CoverIdentity {
  id: string;
  title: string;
}

export function glyphMarkup(identity: CoverIdentity, options: { large?: boolean } = {}): Raw {
  const [bg, ink] = GLYPH_TONES[hashString(identity.id) % GLYPH_TONES.length]!;
  return html`<span class="glyph${options.large ? " glyph--large" : ""}" style="--glyph-bg: ${bg}; --glyph-ink: ${ink}" aria-hidden="true">
    <span class="glyph__char">${titleGlyph(identity.title)}</span>
    ${options.large ? html`<span class="glyph__caption">${identity.title}</span><span class="glyph__seal">鸢</span>` : ""}
  </span>`;
}

/** 封面容器。data-* 让加载失败时能原地换成字符封面（见 main.ts）。 */
export function coverMarkup(coverUrl: string | null, identity: CoverIdentity, options: { fit?: "cover" | "contain"; eager?: boolean; large?: boolean } = {}): Raw {
  const inner = coverUrl
    ? html`<img class="cover__image cover__image--${options.fit ?? "cover"}" src="${contentUrl(coverUrl)}" alt="" loading="${options.eager ? "eager" : "lazy"}" decoding="async" data-cover />`
    : glyphMarkup(identity, options);
  return html`<div class="cover" data-cover-id="${identity.id}" data-cover-title="${identity.title}" ${options.large ? "data-cover-large" : ""}>${inner}</div>`;
}

export function yearBadge(year: number | null): Raw {
  return year === null ? html`` : html`<span class="year">${year}</span>`;
}

export function tagChips(tagIds: string[], lookup: TagLookup, options: { asLinks?: boolean } = {}): Raw {
  if (!tagIds.length) return html``;
  const chips = tagIds.map((id) => {
    const info = lookup.byId.get(id);
    const name = info?.tag.name ?? id;
    const style = info ? `--hue: ${groupHue(info.groupIndex)}` : "";
    const title = info ? `${info.group.name}：${name}` : name;
    if (options.asLinks && info) {
      const params = new URLSearchParams();
      params.append("tag", id);
      return html`<li><a class="chip chip--link" style="${style}" href="${homeHref(params.toString())}" title="${title}">${name}</a></li>`;
    }
    return html`<li><span class="chip${info ? "" : " chip--unknown"}" style="${style}" title="${title}">${name}</span></li>`;
  });
  return html`<ul class="tags" role="list" aria-label="标签">${chips}</ul>`;
}

/* --------------------------------------------------------------------------
   人员
   -------------------------------------------------------------------------- */

/** 常见职责的展示顺序；未列出的职责按出现顺序排在后面，平台导入的艺人字段放最后。 */
const ROLE_ORDER = ["演唱", "原唱", "翻唱", "作词", "填词", "作曲", "编曲", "和声", "混音", "母带", "制作", "监制", "企划", "策划", "PV", "曲绘"];
const TRAILING_ROLES = new Set(["网易云艺人"]);

function roleRank(role: string): number {
  if (TRAILING_ROLES.has(role)) return 2000;
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? 1000 : index;
}

/** 平台导入的艺人字段若只是重复其他职责里已有的人，就不再单独列出。 */
function isRedundantTrailing(role: string, names: string[], people: RoleMap): boolean {
  if (!TRAILING_ROLES.has(role)) return false;
  const credited = new Set(Object.entries(people).flatMap(([other, list]) => (TRAILING_ROLES.has(other) ? [] : list)));
  return names.every((name) => credited.has(name));
}

export function orderedRoles(people: RoleMap): Array<[string, string[]]> {
  return Object.entries(people)
    .filter(([role, names]) => names.length > 0 && !isRedundantTrailing(role, names, people))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => roleRank(a.entry[0]) - roleRank(b.entry[0]) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** 汇总多个版本的人员：同一职责下按首次出现顺序去重。 */
export function unionPeople(maps: RoleMap[]): RoleMap {
  const merged = new Map<string, string[]>();
  for (const map of maps) {
    for (const [role, names] of Object.entries(map)) {
      const list = merged.get(role) ?? [];
      for (const name of names) if (!list.includes(name)) list.push(name);
      merged.set(role, list);
    }
  }
  return Object.fromEntries(merged);
}

export function samePeople(a: RoleMap, b: RoleMap): boolean {
  const key = (map: RoleMap): string => JSON.stringify(orderedRoles(map));
  return key(a) === key(b);
}

function nameList(names: string[]): Raw {
  return html`${names.map((name, index) => html`<span class="people__name">${name}</span>${index < names.length - 1 ? html`<span class="people__sep" aria-hidden="true">、</span>` : ""}`)}`;
}

/** 制作人员表（唱片内页式）。没有人员时返回空。 */
export function peopleList(people: RoleMap, options: { compact?: boolean } = {}): Raw {
  const roles = orderedRoles(people);
  if (!roles.length) return html``;
  return html`<dl class="people${options.compact ? " people--compact" : ""}">${roles.map(([role, names]) => html`<div class="people__row"><dt>${role}</dt><dd>${nameList(names)}</dd></div>`)}</dl>`;
}

/* --------------------------------------------------------------------------
   状态
   -------------------------------------------------------------------------- */

export function statusBlock(options: { title: string; message?: string; retry?: boolean; homeLink?: string; kind?: "info" | "error"; level?: 1 | 2 }): Raw {
  const kind = options.kind ?? "info";
  const heading = options.level === 1 ? html`<h1 class="notice__title">${options.title}</h1>` : html`<h2 class="notice__title">${options.title}</h2>`;
  return html`<div class="notice notice--${kind}" role="${kind === "error" ? "alert" : "status"}">
    ${kind === "error" ? icon("circle-alert", { size: 28, className: "notice__icon" }) : html`<span class="notice__glyph" aria-hidden="true">鸢</span>`}
    ${heading}
    ${options.message ? html`<p class="notice__message">${options.message}</p>` : ""}
    <div class="notice__actions">
      ${options.retry ? html`<button type="button" class="button button--primary" data-action="retry">${icon("refresh-cw")}<span>重试</span></button>` : ""}
      ${options.homeLink !== undefined ? html`<a class="button" href="${options.homeLink}">${icon("arrow-left")}<span>返回曲库</span></a>` : ""}
    </div>
  </div>`;
}

export function loadingBlock(text: string): Raw {
  return html`<p class="loading" role="status"><span class="loading__dots" aria-hidden="true"><i></i><i></i><i></i></span>${text}</p>`;
}
