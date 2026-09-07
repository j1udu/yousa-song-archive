import type { IndexedWork, Version, VersionSummary, Work } from "../content/types";
import { mergePeople } from "../content/types";
import { errorMessage, getLyrics, getVersion, getWork, isNotFound, loadCatalog } from "../content/store";
import { html, query as $, setHtml, type Raw } from "../ui/html";
import { icon } from "../ui/icons";
import { coverMarkup, loadingBlock, peopleList, siteFooter, siteHeader, SITE_NAME, statusBlock, tagChips, yearBadge } from "../ui/common";
import { buildTagLookup, type TagLookup } from "../catalog/query";
import { homeHref } from "../router";

export interface WorkViewContext {
  /** 用户已经离开本页时返回 false，避免过期渲染。 */
  alive: () => boolean;
  /** 进入详情时首页保留的查询串，用于“返回曲库”。 */
  search: string;
  onRetry: () => void;
}

type VersionResult = { status: "ok"; version: Version } | { status: "error"; error: unknown };

export async function mountWork(root: HTMLElement, workId: string, context: WorkViewContext): Promise<void> {
  const backHref = homeHref(context.search);
  setHtml(root, html`${siteHeader({ heading: false, search: context.search })}<main class="page work">${backNav(backHref)}${loadingBlock("正在加载作品…")}</main>${siteFooter()}`);
  document.title = `作品 · ${SITE_NAME}`;

  let work: Work;
  let entry: IndexedWork | null;
  let lookup: TagLookup;
  const [catalogResult, workResult] = await Promise.allSettled([loadCatalog(), getWork(workId)]);
  if (!context.alive()) return;
  if (catalogResult.status === "rejected") {
    // 索引/标签目录本身不可用属于站点故障，不能误报为“作品不存在”。
    renderFailure(root, catalogResult.reason, workId, backHref, context.onRetry, { forceError: true });
    return;
  }
  if (workResult.status === "rejected") {
    renderFailure(root, workResult.reason, workId, backHref, context.onRetry);
    return;
  }
  work = workResult.value;
  lookup = buildTagLookup(catalogResult.value.tags);
  entry = catalogResult.value.index.works.find((item) => item.id === workId) ?? null;

  const results = await Promise.allSettled(work.versionOrder.map((id) => getVersion(workId, id)));
  if (!context.alive()) return;
  try {
    renderWork(root, workId, work, entry, lookup, results, context);
  } catch (error) {
    if (!context.alive()) return;
    renderFailure(root, error, workId, backHref, context.onRetry, { forceError: true });
  }
}

function renderWork(
  root: HTMLElement,
  workId: string,
  work: Work,
  entry: IndexedWork | null,
  lookup: TagLookup,
  results: PromiseSettledResult<Version>[],
  context: WorkViewContext,
): void {
  const backHref = homeHref(context.search);
  const versionResults = new Map<string, VersionResult>();
  work.versionOrder.forEach((id, index) => {
    const result = results[index];
    versionResults.set(id, result && result.status === "fulfilled" ? { status: "ok", version: result.value } : { status: "error", error: result?.reason });
  });

  const summaries = new Map<string, VersionSummary>((entry?.versions ?? []).map((version) => [version.id, version]));
  const lyricsUrl = entry?.lyricsUrl ?? (work.lyrics ? `content/works/${workId}/${work.lyrics}` : null);
  const coverUrl = entry?.coverUrl ?? (work.cover ? `content/works/${workId}/${work.cover}` : null);

  document.title = `${work.title} · ${SITE_NAME}`;
  setHtml(
    root,
    html`${siteHeader({ heading: false, search: context.search })}
      <main class="page work">
        ${backNav(backHref)}
        ${heroMarkup(work, coverUrl, lookup)}
        <section class="work__section" aria-labelledby="people-heading">
          <h2 class="section-title" id="people-heading">${icon("users", { size: 18 })}人员资料</h2>
          ${peopleList(work.people)}
        </section>
        <section class="work__section" aria-labelledby="versions-heading">
          <div class="section-head">
            <h2 class="section-title" id="versions-heading">${icon("list-music", { size: 18 })}版本<span class="section-title__count">${work.versionOrder.length}</span></h2>
            ${work.versionOrder.length > 1
              ? html`<div class="section-head__actions">
                  <button type="button" class="link-button" data-action="expand-all">${icon("chevrons-up-down")}<span>全部展开</span></button>
                  <button type="button" class="link-button" data-action="collapse-all">${icon("chevrons-down-up")}<span>全部收起</span></button>
                </div>`
              : ""}
          </div>
          ${work.versionOrder.length
            ? html`<ol class="versions" role="list" data-versions>${work.versionOrder.map((id, index) => versionItem(work, id, index, versionResults.get(id) ?? { status: "error", error: new Error("版本缺失") }, summaries.get(id)))}</ol>`
            : html`<p class="muted">暂无版本资料</p>`}
        </section>
        <section class="work__section" aria-labelledby="lyrics-heading">
          <h2 class="section-title" id="lyrics-heading">${icon("file-text", { size: 18 })}完整歌词</h2>
          ${lyricsUrl
            ? html`<details class="lyrics" data-lyrics data-state="idle">
                <summary class="lyrics__summary"><span class="lyrics__summary-text">展开歌词</span><span class="lyrics__hint">默认折叠，全部版本共用</span>${icon("chevron-down", { className: "summary__chevron" })}</summary>
                <div class="lyrics__body" data-lyrics-body></div>
              </details>`
            : html`<p class="muted">该作品暂未收录歌词。</p>`}
        </section>
        <p class="work__back-bottom"><a class="button" href="${backHref}">${icon("arrow-left")}<span>返回曲库</span></a></p>
      </main>
      ${siteFooter()}`,
  );

  const main = $<HTMLElement>(root, "main");
  focusHeading(root);
  main.addEventListener("click", async (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "expand-all" || action === "collapse-all") {
      for (const panel of main.querySelectorAll<HTMLDetailsElement>("details[data-version]")) panel.open = action === "expand-all";
      return;
    }
    if (action === "retry-version" && target.dataset.version) {
      const id = target.dataset.version;
      const item = target.closest<HTMLElement>("[data-version-item]");
      if (!item) return;
      setHtml(item, loadingBlock("正在重新加载版本…"));
      try {
        const version = await getVersion(workId, id);
        if (!context.alive()) return;
        replaceVersionItem(item, work, id, { status: "ok", version }, summaries.get(id));
      } catch (error) {
        if (!context.alive()) return;
        replaceVersionItem(item, work, id, { status: "error", error }, summaries.get(id));
      }
      return;
    }
    if (action === "retry-lyrics") {
      const details = main.querySelector<HTMLDetailsElement>("details[data-lyrics]");
      if (details && lyricsUrl) {
        details.dataset.state = "idle";
        void loadLyricsInto(details, lyricsUrl, context);
      }
    }
  });

  const lyricsDetails = main.querySelector<HTMLDetailsElement>("details[data-lyrics]");
  if (lyricsDetails && lyricsUrl) {
    lyricsDetails.addEventListener("toggle", () => {
      if (lyricsDetails.open && lyricsDetails.dataset.state === "idle") void loadLyricsInto(lyricsDetails, lyricsUrl, context);
    });
  }
}

function backNav(href: string): Raw {
  return html`<nav class="work__back" aria-label="返回"><a class="back-link" href="${href}">${icon("arrow-left")}<span>返回曲库</span></a></nav>`;
}

function heroMarkup(work: Work, coverUrl: string | null, lookup: TagLookup): Raw {
  return html`<section class="work__hero">
    <div class="work__cover">${coverMarkup(coverUrl, { fit: "contain", eager: true })}</div>
    <div class="work__intro">
      <p class="work__meta">${yearBadge(work.year)}</p>
      <h1 class="work__title">${work.title}</h1>
      ${work.aliases.length ? html`<p class="work__aliases"><span class="work__aliases-label">别名</span>${work.aliases.map((alias, index) => html`<span class="work__alias">${alias}</span>${index < work.aliases.length - 1 ? html`<span class="work__alias-sep" aria-hidden="true">·</span>` : ""}`)}</p>` : ""}
      ${tagChips(work.tags, lookup, { asLinks: true })}
      ${work.summary.trim() ? html`<p class="work__summary">${work.summary}</p>` : ""}
    </div>
  </section>`;
}

function versionItem(work: Work, id: string, index: number, result: VersionResult, summary: VersionSummary | undefined): Raw {
  return html`<li class="version" data-version-item data-version-id="${id}">${versionInner(work, id, index, result, summary)}</li>`;
}

function replaceVersionItem(item: HTMLElement, work: Work, id: string, result: VersionResult, summary: VersionSummary | undefined): void {
  const index = work.versionOrder.indexOf(id);
  setHtml(item, versionInner(work, id, index, result, summary));
  if (result.status === "ok") $<HTMLElement>(item, "summary").focus();
  else $<HTMLElement>(item, "[data-action='retry-version']").focus();
}

function versionInner(work: Work, id: string, index: number, result: VersionResult, summary: VersionSummary | undefined): Raw {
  const number = String(index + 1).padStart(2, "0");
  if (result.status === "error") {
    return html`<div class="version__error">
      <span class="version__index" aria-hidden="true">${number}</span>
      <div class="version__error-body">
        <p class="version__name">${summary?.name ?? id}</p>
        <p class="version__error-text">${icon("circle-alert")}<span>版本资料加载失败：${errorMessage(result.error)}</span></p>
        <button type="button" class="button button--small" data-action="retry-version" data-version="${id}">${icon("refresh-cw")}<span>重试</span></button>
      </div>
    </div>`;
  }
  const version = result.version;
  const people = mergePeople(work.people, version.people);
  return html`<details class="version__panel" data-version="${id}">
    <summary class="version__summary">
      <span class="version__index" aria-hidden="true">${number}</span>
      <span class="version__name">${version.name}</span>
      <span class="version__type">${version.type}</span>
      ${icon("chevron-down", { className: "summary__chevron" })}
    </summary>
    <div class="version__body">
      <dl class="facts">
        <div class="facts__row"><dt>${icon("calendar")}日期</dt><dd>${dateMarkup(version.date)}</dd></div>
      </dl>
      <h3 class="version__subtitle">${icon("users")}人员</h3>
      ${peopleList(people)}
      ${version.links.length
        ? html`<h3 class="version__subtitle">${icon("link")}链接</h3>
          <ul class="links" role="list">${version.links.map(
            (link) => html`<li><a class="links__item" href="${link.url}" target="_blank" rel="noopener noreferrer"><span class="links__platform">${link.platform}</span><span class="links__label">${link.label}</span>${icon("external-link", { className: "links__icon" })}<span class="visually-hidden">（新标签页打开）</span></a></li>`,
          )}</ul>`
        : ""}
      ${version.notes.trim() ? html`<h3 class="version__subtitle">备注</h3><p class="version__notes">${version.notes}</p>` : ""}
    </div>
  </details>`;
}

/** 日期原样展示：只有年份时不补造月日。 */
function dateMarkup(date: string | null): Raw {
  if (!date) return html`<span class="muted">日期未知</span>`;
  return html`<time datetime="${date}">${date}</time>`;
}

async function loadLyricsInto(details: HTMLDetailsElement, lyricsUrl: string, context: WorkViewContext): Promise<void> {
  const body = $<HTMLElement>(details, "[data-lyrics-body]");
  details.dataset.state = "loading";
  setHtml(body, loadingBlock("正在加载歌词…"));
  try {
    const text = await getLyrics(lyricsUrl);
    if (!context.alive()) return;
    details.dataset.state = "loaded";
    const normalized = text.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
    if (!normalized.trim()) {
      setHtml(body, html`<p class="muted">歌词文件为空。</p>`);
      return;
    }
    const pre = document.createElement("pre");
    pre.className = "lyrics__text";
    pre.textContent = normalized;
    body.replaceChildren(pre);
    if (document.activeElement === document.body) $<HTMLElement>(details, "summary").focus({ preventScroll: true });
  } catch (error) {
    if (!context.alive()) return;
    details.dataset.state = "error";
    setHtml(
      body,
      html`<div class="inline-error" role="alert">${icon("circle-alert")}<span>歌词加载失败：${errorMessage(error)}</span><button type="button" class="button button--small" data-action="retry-lyrics">${icon("refresh-cw")}<span>重试</span></button></div>`,
    );
    if (document.activeElement === document.body) $<HTMLElement>(details, "[data-action='retry-lyrics']").focus({ preventScroll: true });
  }
}

/** 路由切换后把焦点放到页面主标题，读屏与键盘用户不会掉回文档开头。 */
export function focusHeading(root: HTMLElement): void {
  const heading = root.querySelector<HTMLElement>("main h1, main .notice__title");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

function renderFailure(root: HTMLElement, error: unknown, workId: string, backHref: string, onRetry: () => void, options: { forceError?: boolean } = {}): void {
  const notFound = !options.forceError && isNotFound(error);
  document.title = `${notFound ? "作品不存在" : "加载失败"} · ${SITE_NAME}`;
  setHtml(
    root,
    html`${siteHeader({ heading: false })}
      <main class="page work">
        ${notFound
          ? statusBlock({ title: "作品不存在", message: `没有找到 ID 为“${workId}”的作品，可能链接有误或作品尚未收录。`, homeLink: backHref, level: 1 })
          : statusBlock({ title: "作品加载失败", message: errorMessage(error), retry: true, homeLink: backHref, kind: "error", level: 1 })}
      </main>
      ${siteFooter()}`,
  );
  root.querySelector<HTMLButtonElement>("[data-action='retry']")?.addEventListener("click", onRetry);
  focusHeading(root);
}
