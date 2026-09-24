import type { IndexedWork } from "../content/types";
import { loadVersionPeople, type CatalogData } from "../content/store";
import { html, query as $, raw, setHtml, type Raw } from "../ui/html";
import { icon } from "../ui/icons";
import { coverMarkup, displayType, groupHue, siteFooter, siteHeader, tagChips, yearBadge } from "../ui/common";
import { BRAND_IMAGES } from "../site";
import { contentUrl } from "../content/api";
import { homeHref, onBeforeNavigate, pushUrl, replaceUrl, workHref } from "../router";
import {
  applyQuery,
  availableYears,
  buildTagLookup,
  cardVersions,
  EMPTY_QUERY,
  normalizeText,
  hasFilters,
  pageWindow,
  paginate,
  PAGE_SIZE,
  parseQuery,
  sameQuery,
  searchTerms,
  serializeQuery,
  SORT_OPTIONS,
  type CatalogQuery,
  type TagLookup,
} from "./query";

export interface CatalogView {
  /** 由路由驱动的更新：URL 已经改变，视图同步控件和结果。 */
  update(params: URLSearchParams, reason: "navigate" | "history"): void;
  currentQuery(): CatalogQuery;
  destroy(): void;
}

const URL_SYNC_DELAY = 250;

export function mountCatalog(root: HTMLElement, data: CatalogData, params: URLSearchParams): CatalogView {
  const lookup = buildTagLookup(data.tags);
  const works = data.index.works;
  const years = availableYears(works);
  const normalize = (raw: CatalogQuery): CatalogQuery => (raw.year && !years.includes(Number(raw.year)) ? { ...raw, year: "" } : raw);
  let query = normalize(parseQuery(params, lookup));
  let composing = false;
  let urlTimer: number | null = null;
  let renderedPage = query.page;
  let destroyed = false;
  /** 版本层人员：索引没有，聚焦搜索框或出现搜索词时按需加载一次。 */
  let versionPeople: Map<string, string[]> | null = null;
  let versionPeopleComplete = false;
  let versionPeopleAttempted = false;
  let versionPeopleLoading = false;

  function ensureVersionPeople(retry = false): void {
    // 不完整结果也可用于当前查询，但不能阻止后续搜索意图触发重试。
    // 失败回调本身不传 retry，避免持久失败时自动递归请求。
    if (versionPeopleLoading || versionPeopleComplete || (versionPeopleAttempted && !retry)) return;
    versionPeopleAttempted = true;
    versionPeopleLoading = true;
    void loadVersionPeople(data.index).then((result) => {
      versionPeopleLoading = false;
      if (destroyed) return;
      versionPeople = result.people;
      versionPeopleComplete = result.complete;
      if (searchTerms(query.q).length) renderResults();
    });
  }

  setHtml(root, renderShell(lookup, years, works));

  const input = $<HTMLInputElement>(root, "[data-search]");
  const yearSelect = $<HTMLSelectElement>(root, "[data-year]");
  const sortSelect = $<HTMLSelectElement>(root, "[data-sort]");
  const filters = $<HTMLElement>(root, "[data-filters]");
  const filtersToggle = $<HTMLButtonElement>(root, "[data-filters-toggle]");
  const filtersCount = $<HTMLElement>(root, "[data-filters-count]");
  const clearTags = $<HTMLButtonElement>(root, "[data-clear-tags]");
  const results = $<HTMLElement>(root, "[data-results]");
  const status = $<HTMLElement>(root, "[data-status]");
  const grid = $<HTMLElement>(root, "[data-grid]");
  const pagination = $<HTMLElement>(root, "[data-pagination]");

  function commit(next: CatalogQuery, mode: "push" | "replace", searchIntent = false): void {
    if (sameQuery(next, query)) return;
    query = next;
    render(searchIntent);
    syncUrl(mode);
  }

  function syncUrl(mode: "push" | "replace"): void {
    const href = homeHref(serializeQuery(query));
    if (mode === "push") {
      flushUrl();
      pushUrl(href);
      return;
    }
    if (urlTimer !== null) window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      urlTimer = null;
      replaceUrl(homeHref(serializeQuery(query)));
    }, URL_SYNC_DELAY);
  }

  function flushUrl(): void {
    if (urlTimer === null) return;
    window.clearTimeout(urlTimer);
    urlTimer = null;
    replaceUrl(homeHref(serializeQuery(query)));
  }

  function applySearch(value: string): void {
    if (value === query.q) return;
    commit({ ...query, q: value, page: 1 }, "replace", true);
  }

  input.addEventListener("input", (event) => {
    if (composing || (event as InputEvent).isComposing) return;
    applySearch(input.value);
  });
  input.addEventListener("focus", () => {
    ensureVersionPeople(true);
    if (searchTerms(query.q).length) renderResults();
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    applySearch(input.value);
  });
  $<HTMLFormElement>(root, "[data-toolbar]").addEventListener("submit", (event) => {
    event.preventDefault();
    applySearch(input.value);
    flushUrl();
  });
  yearSelect.addEventListener("change", () => commit({ ...query, year: yearSelect.value, page: 1 }, "push"));
  sortSelect.addEventListener("change", () => {
    const value = sortSelect.value;
    const option = SORT_OPTIONS.find((item) => item.value === value);
    commit({ ...query, sort: option?.value ?? EMPTY_QUERY.sort, page: 1 }, "push");
  });
  filters.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "tag") return;
    const tags = target.checked ? [...query.tags.filter((id) => id !== target.value), target.value] : query.tags.filter((id) => id !== target.value);
    commit({ ...query, tags, page: 1 }, "push");
  });
  clearTags.addEventListener("click", () => {
    commit({ ...query, tags: [], page: 1 }, "push");
    filters.querySelector<HTMLInputElement>("input[name='tag']")?.focus();
  });
  filtersToggle.addEventListener("click", () => {
    const open = filters.dataset.open !== "true";
    filters.dataset.open = String(open);
    filtersToggle.setAttribute("aria-expanded", String(open));
  });
  grid.addEventListener("click", (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    if (target.dataset.action === "clear-all") commit({ ...EMPTY_QUERY, sort: query.sort }, "push");
  });
  window.addEventListener("pagehide", flushUrl);
  // 站内导航（点击卡片等）会先 pushState；挂起的搜索词同步必须在那之前落到首页条目上。
  const offBeforeNavigate = onBeforeNavigate(flushUrl);

  function render(searchIntent = false): void {
    syncControls();
    renderResults(searchIntent);
  }

  function syncControls(): void {
    if (!composing && input.value !== query.q) input.value = query.q;
    if (yearSelect.value !== query.year) yearSelect.value = query.year;
    if (sortSelect.value !== query.sort) sortSelect.value = query.sort;
    const selected = new Set(query.tags);
    for (const box of filters.querySelectorAll<HTMLInputElement>("input[name='tag']")) box.checked = selected.has(box.value);
    clearTags.hidden = query.tags.length === 0;
    filtersCount.textContent = query.tags.length ? String(query.tags.length) : "";
    filtersCount.hidden = query.tags.length === 0;
  }

  function renderResults(retryVersionPeople = false): void {
    const searching = searchTerms(query.q).length > 0;
    if (searching) ensureVersionPeople(retryVersionPeople);
    const matched = applyQuery(works, query, lookup, versionPeople ? { versionPeople } : {});
    const page = paginate(matched, query.page);
    const focusWasInside = results.contains(document.activeElement);
    // 版本层人员异步加载完成后会重绘结果；焦点在某个作品上时，重绘后仍回到同一作品。
    const focusedWork = document.activeElement?.closest<HTMLElement>("[data-card]")?.dataset.work;
    renderedPage = page.page;
    setHtml(
      status,
      statusMarkup(
        page.total,
        works.length,
        page.page,
        page.pages,
        hasFilters(query),
        searching && versionPeopleLoading,
        searching && Boolean(versionPeople) && !versionPeopleComplete,
      ),
    );
    setHtml(grid, gridMarkup(page.items, works.length, lookup, serializeQuery(query), (page.page - 1) * PAGE_SIZE));
    setHtml(pagination, paginationMarkup(query, page.page, page.pages));
    if (focusWasInside && !results.contains(document.activeElement)) {
      const link = focusedWork ? grid.querySelector<HTMLElement>(`[data-card][data-work="${CSS.escape(focusedWork)}"] .card__link`) : null;
      (link ?? results).focus({ preventScroll: true });
    }
  }

  render();

  return {
    update(nextParams, reason) {
      const next = normalize(parseQuery(nextParams, lookup));
      if (sameQuery(next, query)) return;
      const previousPage = renderedPage;
      query = next;
      render();
      if (reason === "navigate" && renderedPage !== previousPage) results.scrollIntoView({ block: "start" });
    },
    currentQuery: () => query,
    destroy() {
      destroyed = true;
      // 此时历史栈顶可能已经是新页面的条目，不能再 replaceState；挂起的同步已由 onBeforeNavigate 处理。
      if (urlTimer !== null) window.clearTimeout(urlTimer);
      urlTimer = null;
      offBeforeNavigate();
      window.removeEventListener("pagehide", flushUrl);
    },
  };
}

function renderShell(lookup: TagLookup, years: number[], works: IndexedWork[]): Raw {
  return html`<a class="skip-link" href="#catalog-results">跳到作品列表</a>
    ${siteHeader()}
    ${mastheadMarkup(works)}
    <main class="page catalog">
      <div class="catalog__layout${lookup.groups.length ? "" : " catalog__layout--no-filters"}">
        <aside class="filters" data-filters data-open="false" aria-label="标签筛选" ${lookup.groups.length ? "" : raw("hidden")}>
          <button type="button" class="filters__toggle" data-filters-toggle aria-expanded="false" aria-controls="filters-body">
            ${icon("sliders-horizontal")}<span>标签筛选</span><span class="filters__count" data-filters-count hidden></span>${icon("chevron-down", { className: "filters__chevron" })}
          </button>
          <div class="filters__body" id="filters-body">
            <div class="filters__head">
              <h2 class="filters__title">标签筛选</h2>
              <button type="button" class="link-button" data-clear-tags hidden>清除标签</button>
            </div>
            <p class="filters__hint">同一组内任选其一，不同组之间同时满足。</p>
            ${lookup.groups.map(
              (group, groupIndex) => html`<fieldset class="tag-group" style="--hue: ${groupHue(groupIndex)}">
                <legend class="tag-group__name">${group.name}</legend>
                <div class="tag-group__options">
                  ${group.tags.map((tag) => html`<label class="tag-option"><input type="checkbox" name="tag" value="${tag.id}" /><span class="chip chip--option">${tag.name}</span></label>`)}
                </div>
              </fieldset>`,
            )}
          </div>
        </aside>
        <section class="results" id="catalog-results" tabindex="-1" aria-label="作品列表" data-results>
          <div class="results__bar">
            <p class="results__status" role="status" data-status></p>
            <div class="results__controls" role="group" aria-label="年份与排序">
              <label class="select">
                <span class="select__label">年份</span>
                <select name="year" data-year>
                  <option value="">全部</option>
                  ${years.map((year) => html`<option value="${year}">${year}</option>`)}
                </select>
                ${icon("chevron-down", { className: "select__chevron" })}
              </label>
              <label class="select">
                <span class="select__label">排序</span>
                <select name="sort" data-sort>
                  ${SORT_OPTIONS.map((option) => html`<option value="${option.value}">${option.label}</option>`)}
                </select>
                ${icon("chevron-down", { className: "select__chevron" })}
              </label>
            </div>
          </div>
          <ol class="results__list" role="list" data-grid></ol>
          <nav class="pagination" aria-label="分页" data-pagination></nav>
        </section>
      </div>
    </main>
    ${siteFooter()}`;
}

function mastheadMarkup(works: IndexedWork[]): Raw {
  const versions = works.reduce((sum, work) => sum + work.versions.length, 0);
  const lyrics = works.filter((work) => work.lyricsUrl).length;
  const hero = BRAND_IMAGES.hero;
  return html`<section class="masthead${hero ? " masthead--art" : ""}" aria-labelledby="site-title">
    <div class="masthead__inner">
      <div class="masthead__text">
        <p class="masthead__eyebrow">非官方粉丝资料站</p>
        <h1 class="masthead__title" id="site-title"><span class="masthead__name">泠鸢yousa</span><span class="masthead__sub">歌曲资料库</span></h1>
        <p class="masthead__stats">
          <span><strong>${works.length}</strong> 部作品</span>
          <span><strong>${versions}</strong> 个版本</span>
          <span><strong>${lyrics}</strong> 首歌词</span>
        </p>
        <form class="search" role="search" aria-label="搜索作品" data-toolbar>
          <label class="search__field">
            <span class="visually-hidden">搜索作品</span>
            ${icon("search", { className: "search__icon", size: 20 })}
            <input class="search__input" type="search" name="q" data-search placeholder="搜索标题、别名、人员或版本名称" autocomplete="off" enterkeyhint="search" spellcheck="false" />
          </label>
        </form>
      </div>
      ${hero ? html`<div class="masthead__art"><img src="${contentUrl(hero)}" alt="" decoding="async" /></div>` : html`<div class="masthead__motif" aria-hidden="true">鸢</div>`}
    </div>
  </section>`;
}

function statusMarkup(
  found: number,
  total: number,
  page: number,
  pages: number,
  filtered: boolean,
  loadingVersionPeople: boolean,
  incompleteVersionPeople: boolean,
): Raw {
  if (total === 0) return html`<span class="results__count">曲库暂无作品</span>`;
  const count = filtered ? html`找到 <strong>${found}</strong> 部作品<span class="results__total"> / 共 ${total} 部</span>` : html`全部作品 <strong>${total}</strong>`;
  const note = loadingVersionPeople
    ? html`<span class="results__note" data-version-people-loading>正在读取版本人员资料，结果稍后自动更新…</span>`
    : incompleteVersionPeople
      ? html`<span class="results__note" data-version-people-incomplete>部分版本人员资料读取失败，继续搜索或重新聚焦后重试。</span>`
      : "";
  const pageInfo = pages > 1 ? html`<span class="results__page">第 ${page} / ${pages} 页</span>` : "";
  return html`<span class="results__count">${count}</span>${pageInfo}${note}`;
}

function gridMarkup(items: IndexedWork[], total: number, lookup: TagLookup, search: string, offset: number): Raw {
  if (total === 0) {
    return html`<li class="empty">
      <span class="empty__glyph" aria-hidden="true">鸢</span>
      <h2 class="empty__title">曲库暂无作品</h2>
      <p class="empty__text">作品资料整理中，暂时没有可浏览的内容。</p>
    </li>`;
  }
  if (!items.length) {
    return html`<li class="empty">
      <span class="empty__glyph" aria-hidden="true">${icon("search-x", { size: 30 })}</span>
      <h2 class="empty__title">没有符合条件的作品</h2>
      <p class="empty__text">试试更换关键词、年份或减少标签条件。</p>
      <button type="button" class="button" data-action="clear-all">${icon("x")}<span>清除全部筛选</span></button>
    </li>`;
  }
  return html`${items.map((work, index) => cardMarkup(work, lookup, search, offset + index + 1))}`;
}

function cardMarkup(work: IndexedWork, lookup: TagLookup, search: string, number: number): Raw {
  const { all } = cardVersions(work);
  const notes = versionNotes(work);
  return html`<li class="card" data-card data-work="${work.id}">
    <span class="card__number" aria-hidden="true">${String(number).padStart(3, "0")}</span>
    <div class="card__cover">${coverMarkup(work.coverUrl, work)}</div>
    <div class="card__body">
      <h2 class="card__title"><a class="card__link" href="${workHref(work.id, search)}">${work.title}</a></h2>
      ${work.aliases.length || notes.length
        ? html`<p class="card__sub">
            ${work.aliases.length ? html`<span class="card__alias">${work.aliases.join(" / ")}</span>` : ""}
            ${notes.length ? html`<span class="version-names">${notes.map((note) => html`<span class="version-names__item">${note}</span>`)}</span>` : ""}
          </p>`
        : ""}
      ${tagChips(work.tags, lookup)}
    </div>
    <div class="card__meta">
      ${yearBadge(work.year)}
      ${all.length > 1 ? html`<span class="card__count">${all.length} 个版本</span>` : ""}
    </div>
    ${icon("chevron-right", { className: "card__arrow" })}
  </li>`;
}

/** 列表副标题中的版本提示：只显示与作品标题不同的重点版本名，或有意义的版本类型。 */
function versionNotes(work: IndexedWork): string[] {
  const { shown } = cardVersions(work);
  const title = normalizeText(work.title);
  const notes: string[] = [];
  for (const version of shown) {
    const name = normalizeText(version.name) === title ? "" : version.name;
    const note = name || displayType(version.type);
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

function paginationMarkup(query: CatalogQuery, page: number, pages: number): Raw {
  if (pages <= 1) return html``;
  const href = (target: number): string => homeHref(serializeQuery({ ...query, page: target }));
  const previous = page > 1 ? html`<a class="pagination__nav" href="${href(page - 1)}" rel="prev">${icon("chevron-left")}<span>上一页</span></a>` : html`<span class="pagination__nav pagination__nav--disabled" aria-hidden="true">${icon("chevron-left")}<span>上一页</span></span>`;
  const next = page < pages ? html`<a class="pagination__nav" href="${href(page + 1)}" rel="next"><span>下一页</span>${icon("chevron-right")}</a>` : html`<span class="pagination__nav pagination__nav--disabled" aria-hidden="true"><span>下一页</span>${icon("chevron-right")}</span>`;
  const numbers = pageWindow(page, pages).map((item) =>
    item === "gap"
      ? html`<li aria-hidden="true"><span class="pagination__gap">…</span></li>`
      : html`<li><a class="pagination__page" href="${href(item)}" ${item === page ? raw('aria-current="page"') : ""} aria-label="第 ${item} 页">${item}</a></li>`,
  );
  return html`${previous}<ol class="pagination__pages" role="list">${numbers}</ol>${next}`;
}
