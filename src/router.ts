/**
 * 路由约定：
 * - 首页：无 hash（或 `#/`），查询状态保存在 `?q=&year=&tag=&sort=&page=` 中。
 * - 详情：`#/work/{id}`；GitHub Pages 刷新不会 404。
 * - 其他以 `#/` 开头的 hash 视为不存在的页面；普通页内锚点（如 `#catalog-results`）仍归首页。
 */
export type Route = { kind: "home"; params: URLSearchParams } | { kind: "work"; id: string } | { kind: "missing"; hash: string };

export interface RouteChange {
  fromHistory: boolean;
}

type RouteListener = (change: RouteChange) => void;

const listeners = new Set<RouteListener>();
const beforeNavigateHooks = new Set<() => void>();

/** 在 navigate() 写入新历史条目之前执行，供视图把挂起的 URL 同步先落到当前条目。 */
export function onBeforeNavigate(hook: () => void): () => void {
  beforeNavigateHooks.add(hook);
  return () => beforeNavigateHooks.delete(hook);
}

export function currentRoute(): Route {
  const hash = window.location.hash;
  if (!hash.startsWith("#/") || hash === "#/") return { kind: "home", params: new URLSearchParams(window.location.search) };
  const match = /^#\/work\/([^/?#]+)\/?$/.exec(hash);
  if (match) {
    try {
      return { kind: "work", id: decodeURIComponent(match[1] ?? "") };
    } catch {
      return { kind: "missing", hash };
    }
  }
  return { kind: "missing", hash };
}

export function currentSearch(): string {
  return window.location.search.replace(/^\?/, "");
}

export function homeHref(search = ""): string {
  return `${window.location.pathname}${search ? `?${search}` : ""}`;
}

export function workHref(id: string, search = ""): string {
  return `${homeHref(search)}#/work/${encodeURIComponent(id)}`;
}

export function pushUrl(href: string): void {
  try {
    window.history.pushState({}, "", href);
  } catch {
    /* 浏览器限流时保持页面状态即可 */
  }
}

export function replaceUrl(href: string): void {
  try {
    window.history.replaceState(window.history.state ?? {}, "", href);
  } catch {
    /* 同上 */
  }
}

function rememberScroll(): void {
  try {
    window.history.replaceState({ ...(window.history.state ?? {}), scrollY: window.scrollY }, "", window.location.href);
  } catch {
    /* 忽略 */
  }
}

/** 切换视图的导航：写入历史记录并通知监听者。 */
export function navigate(href: string, options: { replace?: boolean } = {}): void {
  for (const hook of beforeNavigateHooks) hook();
  // 旧页面挂起的滚动记录不能写到新条目上
  cancelScrollTracking();
  if (options.replace) replaceUrl(href);
  else {
    rememberScroll();
    pushUrl(href);
  }
  emit({ fromHistory: false });
}

/** 程序化恢复滚动位置时不受 scroll-behavior: smooth 影响。 */
export function scrollToInstant(top: number): void {
  window.scrollTo({ top, left: 0, behavior: "instant" });
}

/**
 * scrollRestoration 已设为 manual，因此把滚动位置节流写入当前历史条目，
 * 刷新、前进/后退都能恢复；节流间隔避开 Safari 对 replaceState 的频率限制。
 */
let scrollTimer: number | null = null;

function cancelScrollTracking(): void {
  if (scrollTimer !== null) window.clearTimeout(scrollTimer);
  scrollTimer = null;
}

export function trackScrollPosition(): void {
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTimer === null) {
        scrollTimer = window.setTimeout(() => {
          scrollTimer = null;
          rememberScroll();
        }, 500);
      }
    },
    { passive: true },
  );
  window.addEventListener("pagehide", () => {
    cancelScrollTracking();
    rememberScroll();
  });
}

export function savedScroll(): number | null {
  const state: unknown = window.history.state;
  if (state && typeof state === "object" && typeof (state as { scrollY?: unknown }).scrollY === "number") return (state as { scrollY: number }).scrollY;
  return null;
}

export function listen(listener: RouteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(change: RouteChange): void {
  for (const listener of listeners) listener(change);
}

window.addEventListener("popstate", () => {
  cancelScrollTracking();
  emit({ fromHistory: true });
});

/** 拦截站内链接点击，走 pushState 而不是整页刷新；外链、新标签页和修饰键保持原生行为。 */
export function installLinkInterceptor(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download") || anchor.origin !== window.location.origin || anchor.pathname !== window.location.pathname) return;
    if (anchor.hash && !anchor.hash.startsWith("#/")) return; // 页内锚点
    event.preventDefault();
    navigate(anchor.href);
  });
}
