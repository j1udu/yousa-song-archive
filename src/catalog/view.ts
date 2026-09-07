import type { IndexedWork } from "../content/types";
import { loadVersionPeople, type CatalogData } from "../content/store";
import { html, query as $, raw, setHtml, type Raw } from "../ui/html";
import { icon } from "../ui/icons";
import { coverMarkup, groupHue, siteFooter, siteHeader, tagChips, yearBadge } from "../ui/common";
import { homeHref, onBeforeNavigate, pushUrl, replaceUrl, workHref } from "../router";
import {
  applyQuery,
  availableYears,
  buildTagLookup,
  cardVersions,
  EMPTY_QUERY,
  hasFilters,
  pageWindow,
  paginate,
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

/** 卡片“全部版本”的展开状态在会话内保留，从详情返回后不丢失。 */
const expandedCards = new Set<string>();
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

  setHtml(root, renderShell(lookup, years));

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
    if (target.dataset.action === "toggle-versions" && target.dataset.work) {
      const id = target.dataset.work;
      if (expandedCards.has(id)) expandedCards.delete(id);
      else expandedCards.add(id);
      const work = works.find((item) => item.id === id);
      const card = target.closest<HTMLElement>("[data-card]");
      if (work && card) {
        setHtml($(card, "[data-card-versions]"), cardVersionsMarkup(work));
        $<HTMLButtonElement>(card, "[data-action='toggle-versions']").focus();
      }
      return;
    }
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
    setHtml(grid, gridMarkup(page.items, works.length, lookup, serializeQuery(query)));
    setHtml(pagination, paginationMarkup(query, page.page, page.pages));
    if (focusWasInside && !results.contains(document.activeElement)) results.focus({ preventScroll: true });
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

function renderShell(lookup: TagLookup, years: number[]): Raw {
  return html`<a class="skip-link" href="#catalog-results">跳到作品列表</a>
    ${siteHeader({ heading: true })}
    <main class="page catalog">
      <form class="toolbar" role="search" aria-label="搜索与排序" data-toolbar>
        <label class="search">
          <span class="visually-hidden">搜索作品</span>
          ${icon("search", { className: "search__icon" })}
          <input class="search__input" type="search" name="q" data-search placeholder="搜索标题、别名、人员或版本名称" autocomplete="off" enterkeyhint="search" spellcheck="false" />
        </label>
        <label class="select">
          <span class="select__label">${icon("calendar")}年份</span>
          <select name="year" data-year>
            <option value="">全部年份</option>
            ${years.map((year) => html`<option value="${year}">${year}</option>`)}
          </select>
        </label>
        <label class="select">
          <span class="select__label">${icon("arrow-up-down")}排序</span>
          <select name="sort" data-sort>
            ${SORT_OPTIONS.map((option) => html`<option value="${option.value}">${option.label}</option>`)}
          </select>
        </label>
      </form>
      <div class="catalog__layout${lookup.groups.length ? "" : " catalog__layout--no-filters"}">
        <aside class="filters" data-filters data-open="false" aria-label="标签筛选" ${lookup.groups.length ? "" : raw("hidden")}>
          <button type="button" class="filters__toggle" data-filters-toggle aria-expanded="false" aria-controls="filters-body">
            ${icon("sliders-horizontal")}<span>标签筛选</span><span class="filters__count" data-filters-count hidden></span>${icon("chevron-down", { className: "filters__chevron" })}
          </button>
          <div class="filters__body" id="filters-body">
            <div class="filters__head">
              <h2 class="filters__title">${icon("tag")}标签筛选</h2>
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
          <p class="results__status" role="status" data-status></p>
          <div class="results__grid" data-grid></div>
          <nav class="pagination" aria-label="分页" data-pagination></nav>
        </section>
      </div>
    </main>
    ${siteFooter()}`;
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
  const count = filtered ? html`找到 <strong>${found}</strong> 个作品<span class="results__total">，曲库共 ${total} 个</span>` : html`曲库共 <strong>${total}</strong> 个作品`;
  const note = loadingVersionPeople
    ? html`<span class="results__note" data-version-people-loading>正在读取版本人员资料，结果稍后自动更新…</span>`
    : incompleteVersionPeople
      ? html`<span class="results__note" data-version-people-incomplete>部分版本人员资料读取失败，继续搜索或重新聚焦后重试。</span>`
      : "";
  const pageInfo = pages > 1 ? html`<span class="results__page">第 ${page} / ${pages} 页</span>` : "";
  return html`<span class="results__count">${count}</span>${note}${pageInfo}`;
}

function gridMarkup(items: IndexedWork[], total: number, lookup: TagLookup, search: string): Raw {
  if (total === 0) {
    return html`<div class="empty">
      ${icon("library-big", { size: 32, className: "empty__icon" })}
      <h2 class="empty__title">曲库暂无作品</h2>
      <p class="empty__text">作品资料整理中，暂时没有可浏览的内容。</p>
    </div>`;
  }
  if (!items.length) {
    return html`<div class="empty">
      ${icon("search-x", { size: 32, className: "empty__icon" })}
      <h2 class="empty__title">没有符合条件的作品</h2>
      <p class="empty__text">试试更换关键词、年份或减少标签条件。</p>
      <button type="button" class="button" data-action="clear-all">${icon("x")}<span>清除全部筛选</span></button>
    </div>`;
  }
  return html`${items.map((work) => cardMarkup(work, lookup, search))}`;
}

function cardMarkup(work: IndexedWork, lookup: TagLookup, search: string): Raw {
  return html`<article class="card" data-card data-work="${work.id}">
    <div class="card__cover">${coverMarkup(work.coverUrl, { fit: "cover" })}</div>
    <div class="card__body">
      <div class="card__meta">${yearBadge(work.year)}</div>
      <h2 class="card__title"><a class="card__link" href="${workHref(work.id, search)}">${work.title}</a></h2>
      ${tagChips(work.tags, lookup)}
      <div class="card__versions" data-card-versions>${cardVersionsMarkup(work)}</div>
    </div>
  </article>`;
}

function cardVersionsMarkup(work: IndexedWork): Raw {
  const { shown, all } = cardVersions(work);
  if (!all.length) return html`<p class="card__versions-empty muted">暂无版本资料</p>`;
  const expanded = expandedCards.has(work.id);
  const list = expanded ? all : shown;
  const hasMore = all.length > shown.length;
  return html`<p class="card__versions-label">版本<span class="card__versions-count">${all.length}</span></p>
    <ul class="version-names" role="list">${list.map((version) => html`<li class="version-names__item">${version.name}</li>`)}</ul>
    ${hasMore
      ? html`<button type="button" class="card__expand" data-action="toggle-versions" data-work="${work.id}" aria-expanded="${expanded ? "true" : "false"}">
          <span>${expanded ? "收起版本" : `全部 ${all.length} 个版本`}</span>${icon(expanded ? "chevrons-down-up" : "chevrons-up-down")}
        </button>`
      : ""}`;
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
