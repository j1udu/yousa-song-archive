import "./styles.css";
import { loadCatalog, errorMessage } from "./content/store";
import { mountCatalog, type CatalogView } from "./catalog/view";
import { focusHeading, mountWork } from "./work/view";
import { currentRoute, currentSearch, homeHref, installLinkInterceptor, listen, savedScroll, scrollToInstant, trackScrollPosition, type RouteChange } from "./router";
import { html, setHtml } from "./ui/html";
import { glyphMarkup, loadingBlock, siteFooter, siteHeader, SITE_NAME, statusBlock } from "./ui/common";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("找不到应用容器 #app");
const app = root;

window.history.scrollRestoration = "manual";
installLinkInterceptor(app);
installCoverFallback(app);
trackScrollPosition();

let catalogView: CatalogView | null = null;
/** 离开首页时的滚动位置与查询串；只有回到同一查询（“返回曲库”）时才恢复位置。 */
let lastCatalog: { scrollY: number; search: string } | null = null;
let navigationToken = 0;

async function route(change: RouteChange): Promise<void> {
  const token = ++navigationToken;
  const alive = (): boolean => token === navigationToken;
  const current = currentRoute();

  // 页内锚点（如跳转链接 #catalog-results）由浏览器自己滚动，不做位置恢复。
  const anchorJump = window.location.hash !== "" && !window.location.hash.startsWith("#/");

  if (current.kind === "home") {
    if (catalogView) {
      catalogView.update(current.params, change.fromHistory ? "history" : "navigate");
      if (change.fromHistory && !anchorJump) scrollToInstant(savedScroll() ?? 0);
      return;
    }
    document.title = SITE_NAME;
    setHtml(app, html`${siteHeader()}<main class="page catalog">${loadingBlock("正在加载曲库…")}</main>${siteFooter()}`);
    try {
      const data = await loadCatalog();
      if (!alive()) return;
      catalogView = mountCatalog(app, data, current.params);
      const returning = lastCatalog && lastCatalog.search === currentSearch() ? lastCatalog.scrollY : 0;
      if (!anchorJump) scrollToInstant(change.fromHistory ? (savedScroll() ?? 0) : returning);
      // 从详情等页面切回曲库时把焦点放到结果区；首次加载保持默认焦点，跳转链接仍是第一个 Tab 目标。
      if (lastCatalog !== null) app.querySelector<HTMLElement>("#catalog-results")?.focus({ preventScroll: true });
      lastCatalog = null;
    } catch (error) {
      if (!alive()) return;
      setHtml(
        app,
        html`${siteHeader()}<main class="page catalog">${statusBlock({ title: "曲库暂时无法加载", message: errorMessage(error), retry: true, kind: "error" })}</main>${siteFooter()}`,
      );
      app.querySelector<HTMLButtonElement>("[data-action='retry']")?.addEventListener("click", () => void route({ fromHistory: false }));
      focusHeading(app);
    }
    return;
  }

  leaveCatalog();

  if (current.kind === "work") {
    const search = currentSearch();
    await mountWork(app, current.id, { alive, search, onRetry: () => void route({ fromHistory: false }) });
    if (!alive()) return;
    scrollToInstant(change.fromHistory ? (savedScroll() ?? 0) : 0);
    return;
  }

  document.title = `页面不存在 · ${SITE_NAME}`;
  setHtml(
    app,
    html`${siteHeader()}<main class="page">${statusBlock({ title: "页面不存在", message: `没有与“${current.hash}”对应的页面。`, homeLink: homeHref(currentSearch()), level: 1 })}</main>${siteFooter()}`,
  );
  scrollToInstant(0);
  focusHeading(app);
}

function leaveCatalog(): void {
  if (!catalogView) return;
  lastCatalog = { scrollY: window.scrollY, search: currentSearch() };
  catalogView.destroy();
  catalogView = null;
}

/** 封面加载失败时换成字符封面；error 事件不冒泡，因此在捕获阶段监听。 */
function installCoverFallback(scope: HTMLElement): void {
  scope.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.hasAttribute("data-cover")) return;
      const holder = target.closest<HTMLElement>(".cover");
      if (!holder) return;
      const identity = { id: holder.dataset.coverId ?? "", title: holder.dataset.coverTitle ?? "" };
      setHtml(holder, glyphMarkup(identity, { large: holder.hasAttribute("data-cover-large") }));
    },
    true,
  );
}

listen((change) => void route(change));
void route({ fromHistory: true });
