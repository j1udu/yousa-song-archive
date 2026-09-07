import type { RoleMap } from "../content/types";
import { contentUrl } from "../content/api";
import { displayYear, type TagLookup } from "../catalog/query";
import { html, type Raw } from "./html";
import { icon } from "./icons";
import { homeHref } from "../router";

export const SITE_NAME = "泠鸢yousa 歌曲资料库";
export const COVER_PLACEHOLDER = "暂无封面";

/** 分组配色：按分组顺序循环取色相，卡片和筛选面板共用。 */
const GROUP_HUES = [196, 24, 268, 152, 336, 44];

export function groupHue(groupIndex: number): number {
  return GROUP_HUES[groupIndex % GROUP_HUES.length] ?? GROUP_HUES[0]!;
}

export function siteHeader(options: { heading: boolean; search?: string }): Raw {
  const brand = html`<a class="brand" href="${homeHref(options.search ?? "")}"><span class="brand__mark" aria-hidden="true">鸢</span><span class="brand__text"><span class="brand__name">泠鸢yousa</span><span class="brand__sub">歌曲资料库</span></span></a>`;
  return html`<header class="site-header">
    <div class="site-header__inner">
      ${options.heading ? html`<h1 class="brand-wrap">${brand}</h1>` : html`<p class="brand-wrap">${brand}</p>`}
      <p class="site-header__note">非官方资料站 · 整理作品、版本与歌词</p>
    </div>
  </header>`;
}

export function siteFooter(): Raw {
  return html`<footer class="site-footer">
    <p>本站为粉丝整理的非官方资料站，与泠鸢yousa本人及所属团队无关。</p>
    <p>作品信息与歌词的版权归原作者及相关权利人所有。</p>
  </footer>`;
}

/** 封面：固定比例容器；缺失或加载失败时使用统一文字占位。 */
export function coverMarkup(coverUrl: string | null, options: { fit: "cover" | "contain"; eager?: boolean } = { fit: "cover" }): Raw {
  const image = coverUrl
    ? html`<img class="cover__image cover__image--${options.fit}" src="${contentUrl(coverUrl)}" alt="" loading="${options.eager ? "eager" : "lazy"}" decoding="async" data-cover />`
    : coverPlaceholder();
  return html`<div class="cover">${image}</div>`;
}

export function coverPlaceholder(): Raw {
  return html`<span class="cover__placeholder"><span>${COVER_PLACEHOLDER}</span></span>`;
}

export function yearBadge(year: number | null): Raw {
  return html`<span class="year${year === null ? " year--unknown" : ""}">${displayYear(year)}</span>`;
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

export function peopleList(people: RoleMap): Raw {
  const roles = Object.entries(people).filter(([, names]) => names.length > 0);
  if (!roles.length) return html`<p class="muted">暂无人员资料</p>`;
  return html`<dl class="people">${roles.map(
    ([role, names]) => html`<div class="people__row"><dt>${role}</dt><dd>${names.map((name, index) => html`<span class="people__name">${name}</span>${index < names.length - 1 ? html`<span class="people__sep" aria-hidden="true">、</span>` : ""}`)}</dd></div>`,
  )}</dl>`;
}

export function statusBlock(options: { title: string; message?: string; retry?: boolean; homeLink?: string; kind?: "info" | "error"; level?: 1 | 2 }): Raw {
  const kind = options.kind ?? "info";
  const heading = options.level === 1 ? html`<h1 class="notice__title">${options.title}</h1>` : html`<h2 class="notice__title">${options.title}</h2>`;
  return html`<div class="notice notice--${kind}" role="${kind === "error" ? "alert" : "status"}">
    ${kind === "error" ? icon("circle-alert", { size: 28, className: "notice__icon" }) : ""}
    ${heading}
    ${options.message ? html`<p class="notice__message">${options.message}</p>` : ""}
    <div class="notice__actions">
      ${options.retry ? html`<button type="button" class="button button--primary" data-action="retry">${icon("refresh-cw")}<span>重试</span></button>` : ""}
      ${options.homeLink !== undefined ? html`<a class="button" href="${options.homeLink}">${icon("arrow-left")}<span>返回曲库</span></a>` : ""}
    </div>
  </div>`;
}

export function loadingBlock(text: string): Raw {
  return html`<p class="loading" role="status">${text}</p>`;
}
