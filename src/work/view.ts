import type { IndexedWork, Version, VersionSummary, Work } from "../content/types";
import { mergePeople } from "../content/types";
import { errorMessage, getLyrics, getVersion, getWork, isNotFound, loadCatalog } from "../content/store";
import { html, query as $, setHtml, type Raw } from "../ui/html";
import { icon } from "../ui/icons";
import { coverMarkup, displayType, loadingBlock, peopleList, samePeople, siteFooter, siteHeader, SITE_NAME, statusBlock, tagChips, unionPeople } from "../ui/common";
import { buildTagLookup, type TagLookup } from "../catalog/query";
import { homeHref } from "../router";
import { contentUrl } from "../content/api";

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
  setHtml(root, html`${siteHeader({ search: context.search, back: true })}<main class="page work">${loadingBlock("正在加载作品…")}</main>${siteFooter()}`);
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

  // 人员汇总：作品层默认人员与各版本最终人员的并集；各版本一致时不再逐条重复。
  const versionPeople = new Map<string, Work["people"]>();
  for (const [id, result] of versionResults) if (result.status === "ok") versionPeople.set(id, mergePeople(work.people, result.version.people));
  const peopleMaps = [...versionPeople.values()];
  const credits = peopleMaps.length ? unionPeople(peopleMaps) : work.people;
  const uniformPeople = peopleMaps.every((people) => samePeople(people, peopleMaps[0] ?? {}));
  const trackContext: TrackContext = { people: versionPeople, showPeople: !uniformPeople };

  document.title = `${work.title} · ${SITE_NAME}`;
  setHtml(
    root,
    html`${siteHeader({ search: context.search, back: true })}
      <main class="page work">
        ${heroMarkup(work, workId, coverUrl, lookup, credits)}
        <section class="work__section" aria-labelledby="versions-heading">
          <h2 class="section-title" id="versions-heading"><span class="section-title__text">版本</span>${work.versionOrder.length ? html`<span class="section-title__count">${work.versionOrder.length}</span>` : ""}</h2>
          ${work.versionOrder.length
            ? html`<ol class="tracks" role="list" data-versions>${work.versionOrder.map((id, index) => versionItem(work, id, index, versionResults.get(id) ?? { status: "error", error: new Error("版本缺失") }, summaries.get(id), trackContext))}</ol>`
            : html`<p class="work__empty">这部作品还没有收录版本。</p>`}
          <dialog class="download-dialog" data-download-dialog aria-labelledby="download-dialog-title"></dialog>
        </section>
        ${lyricsUrl
          ? html`<section class="work__section" aria-labelledby="lyrics-heading">
              <h2 class="section-title" id="lyrics-heading"><span class="section-title__text">歌词</span></h2>
              <details class="lyrics" data-lyrics data-state="idle">
                <summary class="lyrics__summary">${icon("file-text", { size: 18 })}<span class="lyrics__summary-text" data-open-label="收起歌词">展开完整歌词</span><span class="lyrics__hint">所有版本共用</span>${icon("chevron-down", { className: "summary__chevron" })}</summary>
                <div class="lyrics__body" data-lyrics-body></div>
              </details>
            </section>`
          : ""}
        <p class="work__back-bottom"><a class="button" href="${backHref}">${icon("arrow-left")}<span>返回曲库</span></a></p>
      </main>
      ${siteFooter()}`,
  );

  const main = $<HTMLElement>(root, "main");
  const downloadDialog = $<HTMLDialogElement>(main, "[data-download-dialog]");
  downloadDialog.addEventListener("click", (event) => {
    if (event.target === downloadDialog) downloadDialog.close();
  });
  focusHeading(root);
  main.addEventListener("click", async (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "close-download") {
      target.closest<HTMLDialogElement>("dialog")?.close();
      return;
    }
    if (action === "open-download" && target.dataset.version) {
      const result = versionResults.get(target.dataset.version);
      if (result?.status === "ok") openDownloadDialog(downloadDialog, workId, result.version);
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
        const result: VersionResult = { status: "ok", version };
        versionResults.set(id, result);
        replaceVersionItem(item, work, id, result, summaries.get(id), { ...trackContext, people: new Map(trackContext.people).set(id, mergePeople(work.people, version.people)) });
      } catch (error) {
        if (!context.alive()) return;
        const result: VersionResult = { status: "error", error };
        versionResults.set(id, result);
        replaceVersionItem(item, work, id, result, summaries.get(id), trackContext);
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
    const label = $<HTMLElement>(lyricsDetails, ".lyrics__summary-text");
    const closedLabel = label.textContent ?? "";
    lyricsDetails.addEventListener("toggle", () => {
      label.textContent = lyricsDetails.open ? (label.dataset.openLabel ?? closedLabel) : closedLabel;
      if (lyricsDetails.open && lyricsDetails.dataset.state === "idle") void loadLyricsInto(lyricsDetails, lyricsUrl, context);
    });
  }
}

interface TrackContext {
  /** 版本 ID → 继承/替换后的最终人员。 */
  people: Map<string, Work["people"]>;
  /** 各版本人员不一致时，才在每个版本下单独列出人员。 */
  showPeople: boolean;
}

function heroMarkup(work: Work, workId: string, coverUrl: string | null, lookup: TagLookup, credits: Work["people"]): Raw {
  const people = peopleList(credits);
  return html`<header class="work__hero">
    <div class="work__cover">${coverMarkup(coverUrl, { id: workId, title: work.title }, { fit: "contain", eager: true, large: true })}</div>
    <div class="work__intro">
      <p class="work__eyebrow"><span>作品</span>${work.year !== null ? html`<span class="work__year">${work.year}</span>` : ""}</p>
      <h1 class="work__title">${work.title}</h1>
      ${work.aliases.length ? html`<p class="work__aliases"><span class="work__aliases-label">又名</span>${work.aliases.map((alias, index) => html`<span class="work__alias">${alias}</span>${index < work.aliases.length - 1 ? html`<span class="work__alias-sep" aria-hidden="true">/</span>` : ""}`)}</p>` : ""}
      ${tagChips(work.tags, lookup, { asLinks: true })}
      ${work.summary.trim() ? html`<p class="work__summary">${work.summary}</p>` : ""}
      ${people.value
        ? html`<section class="credits" aria-labelledby="people-heading">
            <h2 class="credits__title" id="people-heading">制作人员</h2>
            ${people}
          </section>`
        : ""}
    </div>
  </header>`;
}

function versionItem(work: Work, id: string, index: number, result: VersionResult, summary: VersionSummary | undefined, context: TrackContext): Raw {
  return html`<li class="track" data-version-item data-version-id="${id}">${versionInner(work, id, index, result, summary, context)}</li>`;
}

function replaceVersionItem(item: HTMLElement, work: Work, id: string, result: VersionResult, summary: VersionSummary | undefined, context: TrackContext): void {
  const index = work.versionOrder.indexOf(id);
  setHtml(item, versionInner(work, id, index, result, summary, context));
  if (result.status === "ok") item.querySelector<HTMLElement>("a, .track__name")?.focus();
  else $<HTMLElement>(item, "[data-action='retry-version']").focus();
}

function versionInner(work: Work, id: string, index: number, result: VersionResult, summary: VersionSummary | undefined, context: TrackContext): Raw {
  const number = String(index + 1).padStart(2, "0");
  if (result.status === "error") {
    return html`<span class="track__index" aria-hidden="true">${number}</span>
      <div class="track__main track__main--error">
        <p class="track__name">${summary?.name ?? id}</p>
        <p class="track__error">${icon("circle-alert")}<span>版本资料加载失败：${errorMessage(result.error)}</span></p>
        <button type="button" class="button button--small" data-action="retry-version" data-version="${id}">${icon("refresh-cw")}<span>重试</span></button>
      </div>`;
  }
  const version = result.version;
  const type = displayType(version.type);
  const downloadable = Boolean(version.audio?.length) && version.audioRights === "authorized";
  const people = context.showPeople ? peopleList(context.people.get(id) ?? mergePeople(work.people, version.people), { compact: true }) : html``;
  return html`<span class="track__index" aria-hidden="true">${number}</span>
    <div class="track__main" data-version="${id}">
      <p class="track__head">
        <span class="track__name" tabindex="-1">${version.name}</span>
        ${type ? html`<span class="track__type">${type}</span>` : ""}
        ${version.date ? html`<time class="track__date" datetime="${version.date}">${version.date}</time>` : ""}
      </p>
      ${people}
      ${version.notes.trim() ? html`<p class="track__notes">${version.notes}</p>` : ""}
    </div>
    ${version.links.length || downloadable
      ? html`<ul class="track__links" role="list" aria-label="${version.name} 的链接">${version.links.map(
          (link) => html`<li><a class="track__link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.label}"><span class="track__platform">${link.platform}</span>${icon("external-link", { size: 14 })}<span class="visually-hidden">（${link.label}，新标签页打开）</span></a></li>`,
        )}${downloadable
          ? html`<li><button type="button" class="track__link track__link--download" data-action="open-download" data-version="${version.id}">${icon("download", { size: 14 })}<span class="track__platform">下载</span></button></li>`
          : ""}</ul>`
      : ""}`;
}

/** 授权音频下载：弹窗列出各音质，点击后由浏览器直接下载，不在页面内预取或播放。 */
function openDownloadDialog(dialog: HTMLDialogElement, workId: string, version: Version): void {
  const audio = version.audio ?? [];
  setHtml(
    dialog,
    html`<div class="download-dialog__head">
        <h2 class="download-dialog__title" id="download-dialog-title"><span class="download-dialog__eyebrow">下载</span>${version.name}</h2>
        <button type="button" class="icon-button" data-action="close-download" aria-label="关闭">${icon("x")}</button>
      </div>
      <p class="download-dialog__hint">请选择要下载的音质</p>
      <ul class="download-dialog__list" role="list">${audio.map((asset) => {
        const href = asset.url ?? contentUrl(`content/works/${workId}/${asset.file}`);
        return html`<li><a class="download-dialog__option" href="${href}" download rel="noopener noreferrer">${icon("download")}<span>${asset.quality}</span><small>${asset.format.toUpperCase()}</small></a></li>`;
      })}</ul>`,
  );
  dialog.showModal();
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
    html`${siteHeader({ back: true })}
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
