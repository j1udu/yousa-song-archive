/**
 * 浏览器验证脚本：用本机 Google Chrome（playwright-core, channel=chrome）检查页面行为并留存截图。
 *
 * 用法：
 *   QA_BASE=http://localhost:4174/yousa-song-archive/ QA_MODE=fixtures node qa/browser-check.mjs
 *   QA_BASE=http://localhost:4175/ QA_MODE=empty node qa/browser-check.mjs
 *
 * fixtures 模式需要先 `npm run build:fixtures && npm run preview:fixtures`。
 * empty 模式针对正式（当前为空）内容：`npm run build && npm run preview`。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.QA_BASE ?? "http://localhost:4174/yousa-song-archive/";
const MODE = process.env.QA_MODE ?? "fixtures";
const OUT = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) if (file.startsWith(`${MODE}-`)) rmSync(`${OUT}${file}`);

const results = [];
let shotIndex = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✔ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.log(`✘ ${name}\n    ${error instanceof Error ? error.message : error}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: 期望 ${e}，实际 ${a}`);
}

async function shot(page, name, options = {}) {
  shotIndex += 1;
  const file = `${OUT}${MODE}-${String(shotIndex).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: options.fullPage ?? true });
  return file;
}

const url = (search = "", hash = "") => `${BASE}${search ? `?${search}` : ""}${hash}`;
const cards = (page) => page.locator("[data-grid] .card");
const status = (page) => page.locator("[data-status]").evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const cardOverflow = async (page) =>
  page.evaluate(() => [...document.querySelectorAll(".card, .card__body, .version__panel, .lyrics__text, .work__intro")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.className));

/* ---------- 独立的“预期结果”计算，用于和页面结果对照 ---------- */
function makeOracle(index, tags, versionPeople = new Map()) {
  const groupOf = new Map();
  for (const group of tags.groups) for (const tag of group.tags) groupOf.set(tag.id, group.id);
  const normalize = (value) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return ({ q = "", year = "", tags: selected = [] }) => {
    const byGroup = new Map();
    for (const id of selected) {
      const group = groupOf.get(id);
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(id);
    }
    const terms = normalize(q).split(" ").filter(Boolean);
    return index.works.filter((work) => {
      if (year && String(work.year ?? "") !== year) return false;
      for (const ids of byGroup.values()) if (!work.tags.some((tag) => ids.includes(tag))) return false;
      const fields = [work.title, ...work.aliases, ...Object.values(work.people).flat(), ...work.versions.map((v) => v.name), ...(versionPeople.get(work.id) ?? [])].map(normalize);
      return terms.every((term) => fields.some((field) => field.includes(term)));
    });
  };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const requests = [];

async function newPage(viewport = { width: 1366, height: 900 }, extra = {}) {
  const context = await browser.newContext({ viewport, locale: "zh-CN", ...extra });
  const page = await context.newPage();
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => console.log("  [pageerror]", error.message));
  return { context, page };
}

if (MODE === "fixtures") await runFixtures();
else await runEmpty();

await browser.close();

const failed = results.filter((item) => !item.ok);
const report = [
  `# 浏览器验证报告（${MODE}）`,
  "",
  `- 基址：${BASE}`,
  `- 结果：${results.length - failed.length} / ${results.length} 通过`,
  "",
  ...results.map((item) => `- [${item.ok ? "x" : " "}] ${item.name}${item.ok ? "" : ` — ${item.error}`}`),
  "",
].join("\n");
writeFileSync(`${OUT}${MODE}-report.md`, report);
console.log(`\n${results.length - failed.length} / ${results.length} 通过；报告：${OUT}${MODE}-report.md`);
process.exit(failed.length ? 1 : 0);

/* ======================================================================== */

async function runFixtures() {
  const index = await (await fetch(`${BASE}content/works-index.json`)).json();
  const tags = await (await fetch(`${BASE}content/tags.json`)).json();
  // 独立读取所有版本文件，计算继承/替换/新增后的最终人员，作为版本层人员搜索的预期值
  const versionPeople = new Map();
  for (const work of index.works) {
    for (const summary of work.versions) {
      const version = await (await fetch(`${BASE}${summary.path}`)).json();
      const merged = { ...work.people, ...version.people };
      versionPeople.set(work.id, [...new Set([...(versionPeople.get(work.id) ?? []), ...Object.values(merged).flat()])]);
    }
  }
  const oracle = makeOracle(index, tags, versionPeople);
  const { page } = await newPage();

  await check("首页加载：站名、12 张卡片、结果数量与页码", async () => {
    await page.goto(url());
    await cards(page).first().waitFor();
    expect((await page.locator("h1").innerText()).includes("泠鸢yousa"), "h1 应包含站名");
    expectEqual(await cards(page).count(), 12, "卡片数");
    const text = await status(page);
    expect(text.includes("30") && text.includes("第 1 / 3 页"), `状态文本：${text}`);
    expect(await page.title() === "泠鸢yousa 歌曲资料库", `document.title=${await page.title()}`);
    await page.waitForLoadState("networkidle");
    await shot(page, "home-desktop");
  });

  await check("子路径：索引、标签、封面请求都在 /yousa-song-archive/content/ 下", async () => {
    const content = requests.filter((item) => item.includes("/content/"));
    expect(content.length > 0, "应有内容请求");
    const wrong = content.filter((item) => !item.startsWith(`${BASE}content/`));
    expectEqual(wrong, [], "越出子路径的请求");
    expect(content.some((item) => item.endsWith("/content/works-index.json")), "应请求索引");
    expect(content.some((item) => item.endsWith("/content/tags.json")), "应请求标签");
    expect(content.some((item) => /\/content\/works\/fx-[^/]+\/cover\.png$/.test(item)), "应请求封面");
  });

  await check("标签分组和标签按 order 排序（与数组顺序不同）", async () => {
    expectEqual(await page.locator(".tag-group__name").allInnerTexts(), ["内容形态", "语言", "场合"], "分组顺序");
    expectEqual(await page.locator(".tag-group").first().locator(".chip").allInnerTexts(), ["原创", "翻唱", "改编", "合作"], "首组标签顺序");
  });

  await check("卡片：featured 为空时回退 versionOrder 前 3 个；展开/收起显示全部且不导航", async () => {
    const card = page.locator(".card[data-work='fx-01-long-title']");
    expectEqual(await card.locator(".version-names__item").allInnerTexts(), ["测试演唱会现场版", "录音室正式版", "合作版"], "默认版本");
    expectEqual(await card.locator(".chip").count(), 11, "全部标签数（不截成 +N）");
    const button = card.locator("[data-action='toggle-versions']");
    expect((await button.innerText()).includes("全部 5 个版本"), "展开按钮文案");
    const before = page.url();
    await button.click();
    expectEqual(page.url(), before, "展开不应改变 URL");
    expectEqual(await card.locator(".version-names__item").allInnerTexts(), ["测试演唱会现场版", "录音室正式版", "合作版", "无链接改编版", "不插电版（人员替换）"], "展开后按 versionOrder");
    expectEqual(await button.getAttribute("aria-expanded"), "true", "aria-expanded");
    expect(!(await card.locator(".version-names__item").first().innerText()).includes("2024"), "卡片版本不显示日期");
    expectEqual(await card.locator("a").count(), 1, "卡片内只有标题一个链接");
    await shot(page, "home-card-expanded");
    await button.click();
    expectEqual(await card.locator(".version-names__item").count(), 3, "收起");
  });

  await check("卡片：featuredVersions 按指定顺序显示（最多 3 个）", async () => {
    const card = page.locator(".card[data-work='fx-02-featured']");
    expectEqual(await card.locator(".version-names__item").allInnerTexts(), ["版本 D（重点）", "版本 B（重点）"], "重点版本");
    expect((await card.locator("[data-action='toggle-versions']").innerText()).includes("全部 4 个版本"), "展开按钮");
  });

  await check("搜索：人员 / 版本名 / 别名（大小写、全角归一）且输入框保持焦点", async () => {
    const input = page.locator("[data-search]");
    await input.fill("独特作曲者");
    await input.pressSequentially("癸");
    expectEqual(await cards(page).allInnerTexts().then((list) => list.length), 1, "人员搜索结果数");
    expect(await page.evaluate(() => document.activeElement === document.querySelector("[data-search]")), "输入框应保持焦点");
    await page.waitForTimeout(400);
    expect(new URL(page.url()).searchParams.get("q") === "独特作曲者癸", `URL q 参数：${page.url()}`);
    await input.fill("星海测试");
    expectEqual(await cards(page).locator(".card__title").allInnerTexts(), ["搜索测试曲"], "版本名搜索");
    await input.fill("searchalias");
    expectEqual(await cards(page).locator(".card__title").allInnerTexts(), ["搜索测试曲"], "别名搜索（大小写）");
    await input.fill("全角abc");
    expectEqual(await cards(page).locator(".card__title").allInnerTexts(), ["搜索测试曲"], "别名搜索（全角归一）");
    await input.fill("夹具 版本 3");
    expectEqual(await cards(page).count(), oracle({ q: "夹具 版本 3" }).length, "多词 AND 搜索");
    await shot(page, "home-search");
  });

  await check("搜索版本层人员：新增/替换角色的人名可命中，版本文件仅在搜索意图出现后才请求", async () => {
    // 用全新上下文统计本页请求，避免前面用例的版本请求干扰
    const { context, page } = await newPage();
    const own = [];
    page.on("request", (request) => own.push(request.url()));
    await page.goto(url());
    await cards(page).first().waitFor();
    await page.waitForLoadState("networkidle");
    await page.click("[data-pagination] a[rel='next']");
    await page.waitForLoadState("networkidle");
    expectEqual(own.filter((item) => /\/version-[^/]+\.json$/.test(item)).length, 0, "浏览与翻页时不请求版本文件");
    const before = requests.length;
    const input = page.locator("[data-search]");
    await input.fill("测试和声者壬"); // 只存在于 fx-07 的版本 v-clear 新增角色“和声”
    await page.waitForFunction(() => document.querySelectorAll("[data-grid] .card").length === 1 && !document.querySelector("[data-version-people-loading]"));
    expectEqual(await cards(page).locator(".card__title").allInnerTexts(), ["人员继承测试曲"], "版本新增角色人员");
    expect(requests.slice(before).some((item) => /\/version-[^/]+\.json$/.test(item)), "搜索后应请求版本文件");
    expect(requests.slice(before).every((item) => !item.includes("/content/") || item.startsWith(`${BASE}content/`)), "版本文件请求在子路径下");
    await input.fill("测试演唱者庚"); // fx-01 v-acoustic 替换、fx-07 v-replace 替换、fx-06 作品层
    const expected = oracle({ q: "测试演唱者庚" });
    await page.waitForFunction((n) => document.querySelectorAll("[data-grid] .card").length === n, expected.length);
    expectEqual((await cards(page).evaluateAll((list) => list.map((el) => el.dataset.work))).sort(), expected.map((w) => w.id).sort(), "替换角色人员与预期一致");
    expect(expected.length >= 3, `预期应至少命中 3 个作品，实际 ${expected.length}`);
    await input.fill("测试编曲者辛 不插电"); // 版本人员 + 版本名称组合
    await page.waitForFunction(() => document.querySelectorAll("[data-grid] .card").length === 1);
    expectEqual(await cards(page).evaluateAll((list) => list.map((el) => el.dataset.work)), ["fx-01-long-title"], "版本人员与版本名称组合搜索");
    await input.fill("测试编曲者丁"); // fx-07 v-clear 清除了编曲，但作品层仍有丁，作品仍应命中
    await page.waitForFunction((n) => document.querySelectorAll("[data-grid] .card").length === n, oracle({ q: "测试编曲者丁" }).length);
    expect((await cards(page).evaluateAll((list) => list.map((el) => el.dataset.work))).includes("fx-07-people"), "被版本清除的作品层人员仍可命中作品");
    await context.close();
  });

  await check("版本人员首次部分失败后，下一次搜索意图会重试并更新结果", async () => {
    const { context, page } = await newPage();
    let clearRequests = 0;
    await page.route("**/fx-07-people/version-v-clear.json", async (route) => {
      clearRequests += 1;
      if (clearRequests === 1) await route.abort();
      else await route.continue();
    });
    await page.goto(url());
    await cards(page).first().waitFor();

    const input = page.locator("[data-search]");
    await input.fill("测试和声者壬");
    await page.waitForFunction(() => !document.querySelector("[data-version-people-loading]"));
    expectEqual(await cards(page).count(), 0, "首次失败时不应命中缺失版本人员");
    expectEqual(clearRequests, 1, "首次应请求一次失败版本文件");
    expectEqual(await page.locator("[data-version-people-incomplete]").count(), 1, "应提示版本人员资料不完整");

    await input.fill("测试和声者壬 ");
    await page.waitForFunction(() => document.querySelectorAll("[data-grid] .card").length === 1 && !document.querySelector("[data-version-people-loading]"));
    expectEqual(clearRequests, 2, "后续搜索意图应再次请求失败版本文件");
    expectEqual(await cards(page).locator(".card__title").allInnerTexts(), ["人员继承测试曲"], "重试后命中版本人员");
    expectEqual(await page.locator("[data-version-people-incomplete]").count(), 0, "成功后不再提示资料不完整");
    await context.close();
  });

  await check("冷加载带搜索词的 URL：版本层人员加载完成后结果自动更新", async () => {
    const { context, page: cold } = await newPage();
    await cold.goto(url("q=%E6%B5%8B%E8%AF%95%E5%92%8C%E5%A3%B0%E8%80%85%E5%A3%AC"));
    await cold.waitForFunction(() => document.querySelectorAll("[data-grid] .card").length === 1 && !document.querySelector("[data-version-people-loading]"));
    expectEqual(await cards(cold).locator(".card__title").allInnerTexts(), ["人员继承测试曲"], "冷加载命中版本人员");
    expectEqual(await cold.inputValue("[data-search]"), "测试和声者壬", "搜索词保留");
    await shot(cold, "home-search-version-people");
    await context.close();
  });

  await check("中文输入法：合成期间不筛选，compositionend 后才应用", async () => {
    await page.locator("[data-search]").fill("");
    expectEqual(await cards(page).count(), 12, "清空后回到第一页 12 张");
    await page.evaluate(() => {
      const input = document.querySelector("[data-search]");
      input.focus();
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.value = "最简";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText", data: "最简" }));
    });
    expectEqual(await cards(page).count(), 12, "合成中不应筛选");
    await page.evaluate(() => {
      const input = document.querySelector("[data-search]");
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "最简" }));
    });
    expectEqual(await cards(page).locator(".card__title").allInnerTexts(), ["最简作品"], "合成结束后筛选");
    expect(await page.evaluate(() => document.activeElement === document.querySelector("[data-search]")), "输入框仍有焦点");
  });

  await check("年份筛选 + 标签组合（组内 OR、组间 AND），页码重置", async () => {
    await page.goto(url("page=2"));
    await cards(page).first().waitFor();
    expect((await status(page)).includes("第 2 / 3 页"), "先到第 2 页");
    await page.check("input[name='tag'][value='original']");
    expect(!new URL(page.url()).searchParams.has("page"), "改标签后页码应重置");
    await page.check("input[name='tag'][value='cover']");
    expectEqual(await cards(page).count(), Math.min(12, oracle({ tags: ["original", "cover"] }).length), "组内 OR");
    expect((await status(page)).includes(`找到 ${oracle({ tags: ["original", "cover"] }).length} 个作品`), `状态：${await status(page)}`);
    await page.check("input[name='tag'][value='ja']");
    const expected = oracle({ tags: ["original", "cover", "ja"] }).length;
    expect((await status(page)).includes(`找到 ${expected} 个作品`), `组间 AND：${await status(page)}`);
    expectEqual(new URL(page.url()).searchParams.getAll("tag"), ["original", "cover", "ja"], "重复 tag 参数");
    await page.selectOption("[data-year]", "2024");
    const expectedYear = oracle({ tags: ["original", "cover", "ja"], year: "2024" }).length;
    expect((await status(page)).includes(`找到 ${expectedYear} 个作品`), `年份+标签：${await status(page)}`);
    for (const text of await cards(page).locator(".year").allInnerTexts()) expectEqual(text, "2024", "卡片年份");
    await shot(page, "home-filters");
    await page.click("[data-clear-tags]");
    expectEqual(new URL(page.url()).searchParams.getAll("tag"), [], "清除标签");
    expect((await status(page)).includes(`找到 ${oracle({ year: "2024" }).length} 个作品`), "仅年份");
  });

  await check("排序：标题 A→Z / Z→A、年份旧→新（未知年份在最后）", async () => {
    await page.goto(url("sort=title-asc"));
    await cards(page).first().waitFor();
    expectEqual(await cards(page).locator(".card__title").allInnerTexts().then((list) => list.slice(0, 2)), ["Alpha Latin Title", "Zeta Latin Title"], "标题升序");
    await page.selectOption("[data-sort]", "title-desc");
    expect((await cards(page).locator(".card__title").first().innerText()) !== "Alpha Latin Title", "标题降序首项");
    await page.goto(url("sort=title-desc&page=3"));
    await cards(page).first().waitFor();
    expectEqual(await cards(page).locator(".card__title").last().innerText(), "Alpha Latin Title", "标题降序末项");
    await page.selectOption("[data-sort]", "year-asc");
    expect(!new URL(page.url()).searchParams.has("page"), "改排序后页码重置");
    expectEqual(await cards(page).locator(".year").first().innerText(), "2015", "年份升序首项");
    await page.goto(url("sort=year-asc&page=3"));
    await cards(page).first().waitFor();
    expectEqual(await cards(page).locator(".year").last().innerText(), "年份未知", "未知年份最后");
    await page.goto(url("page=3"));
    await cards(page).first().waitFor();
    expectEqual(await cards(page).locator(".year").last().innerText(), "年份未知", "年份降序未知也在最后");
  });

  await check("分页：下一页 / 页码 / 前进后退 / 刷新恢复状态", async () => {
    await page.goto(url());
    await cards(page).first().waitFor();
    await page.click("[data-pagination] a[rel='next']");
    expectEqual(new URL(page.url()).searchParams.get("page"), "2", "page=2");
    expect((await status(page)).includes("第 2 / 3 页"), "第 2 页状态");
    expectEqual(await page.locator("[data-pagination] a[aria-current='page']").innerText(), "2", "当前页 aria-current 高亮");
    await page.click("[data-pagination] a[aria-label='第 3 页']");
    expectEqual(await cards(page).count(), 6, "第 3 页 6 张");
    expectEqual(await page.locator("[data-pagination] .pagination__nav--disabled").count(), 1, "末页下一页禁用");
    await page.goBack();
    await page.waitForFunction(() => document.querySelector("[data-status]")?.textContent?.includes("第 2 / 3 页"));
    await page.goBack();
    await page.waitForFunction(() => document.querySelector("[data-status]")?.textContent?.includes("第 1 / 3 页"));
    await page.goForward();
    await page.waitForFunction(() => document.querySelector("[data-status]")?.textContent?.includes("第 2 / 3 页"));
    await shot(page, "home-page2");

    await page.goto(url("q=%E5%A4%B9%E5%85%B7&year=2025&tag=original&tag=zh&sort=title-asc"));
    await cards(page).first().waitFor();
    expectEqual(await page.inputValue("[data-search]"), "夹具", "刷新恢复搜索词");
    expectEqual(await page.inputValue("[data-year]"), "2025", "刷新恢复年份");
    expectEqual(await page.inputValue("[data-sort]"), "title-asc", "刷新恢复排序");
    expectEqual(await page.locator("input[name='tag']:checked").evaluateAll((list) => list.map((el) => el.value)), ["original", "zh"], "刷新恢复标签");
    expectEqual(await cards(page).count(), oracle({ q: "夹具", year: "2025", tags: ["original", "zh"] }).length, "结果与预期一致");
    await page.goto(url("page=99"));
    await cards(page).first().waitFor();
    expect((await status(page)).includes("第 3 / 3 页"), "超范围页码收敛到最后一页");
  });

  await check("详情：标题/别名/年份/标签/简介，人员按角色，版本严格按 versionOrder 且默认收起", async () => {
    await page.goto(url("q=%E9%95%BF%E6%A0%87%E9%A2%98"));
    await cards(page).first().waitFor();
    await page.click(".card[data-work='fx-01-long-title'] .card__link");
    await page.locator("h1.work__title").waitFor();
    expect(page.url().endsWith("?q=%E9%95%BF%E6%A0%87%E9%A2%98#/work/fx-01-long-title"), `详情 URL：${page.url()}`);
    expect((await page.locator("h1.work__title").innerText()).startsWith("长标题测试"), "标题");
    expect((await page.locator(".work__aliases").innerText()).includes("Long Title Alias"), "别名");
    expectEqual(await page.locator(".work__meta .year").innerText(), "2024", "年份");
    expectEqual(await page.locator(".work__intro .chip").count(), 11, "标签数");
    expect((await page.locator(".work__summary").innerText()).includes("第二行简介"), "简介换行");
    expect((await page.title()).startsWith("长标题测试"), "document.title");
    const sections = await page.locator("main .work__section").evaluateAll((list) => list.map((el) => el.querySelector("h2")?.textContent?.trim()));
    expectEqual(sections, ["人员资料", "版本5", "完整歌词"], "区块顺序");
    expectEqual(await page.locator("section[aria-labelledby='people-heading'] dt").allInnerTexts(), ["演唱", "作词", "作曲", "编曲", "混音"], "人员角色顺序");
    expectEqual(await page.locator("details[data-version]").evaluateAll((list) => list.map((el) => el.dataset.version)), ["v-live", "v-studio", "v-collab", "v-remix", "v-acoustic"], "版本顺序");
    expectEqual(await page.locator("details[data-version][open]").count(), 0, "默认全部收起");
    expectEqual(await page.locator("details[data-version='v-live'] .version__summary .version__type").innerText(), "现场", "收起时显示类型");
    expectEqual(await page.locator("details[data-lyrics][open]").count(), 0, "歌词默认折叠");
    await page.waitForLoadState("networkidle");
    await shot(page, "work-desktop-collapsed");
  });

  await check("版本面板：日期不补月日、链接顺序与 rel、无链接版本隐藏链接区、人员替换", async () => {
    await page.click("details[data-version='v-live'] summary");
    expectEqual(await page.locator("details[data-version='v-live'] time").innerText(), "2024", "仅年份日期");
    await page.click("details[data-version='v-studio'] summary");
    const links = page.locator("details[data-version='v-studio'] .links__item");
    expectEqual(await links.locator(".links__platform").allInnerTexts(), ["示例平台A", "示例平台B"], "链接顺序");
    expectEqual(await links.locator(".links__label").allInnerTexts(), ["正式音源", "官方公告"], "链接 label");
    expectEqual(await links.evaluateAll((list) => list.map((a) => [a.target, a.rel])), [["_blank", "noopener noreferrer"], ["_blank", "noopener noreferrer"]], "target/rel");
    expect((await page.locator("details[data-version='v-studio'] .version__notes").innerText()).includes("第二行备注"), "备注换行");
    await page.click("details[data-version='v-remix'] summary");
    expectEqual(await page.locator("details[data-version='v-remix'] .links").count(), 0, "无链接版本隐藏链接区");
    expect(!(await page.locator("details[data-version='v-remix']").innerText()).includes("待补充"), "不显示“链接待补充”");
    expect((await page.locator("details[data-version='v-remix'] .facts").innerText()).includes("日期未知"), "日期未知");
    await page.click("details[data-version='v-acoustic'] summary");
    const rows = await page.locator("details[data-version='v-acoustic'] .people__row").evaluateAll((list) => list.map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]));
    expectEqual(rows, [["演唱", "测试演唱者甲、测试演唱者庚"], ["作词", "测试作词者乙"], ["作曲", "测试作曲者丙"], ["编曲", "测试编曲者辛"], ["混音", "测试混音师己"]], "替换与继承");
    await page.click("[data-action='expand-all']");
    expectEqual(await page.locator("details[data-version][open]").count(), 5, "全部展开");
    await shot(page, "work-desktop-expanded");
    await page.click("[data-action='collapse-all']");
    expectEqual(await page.locator("details[data-version][open]").count(), 0, "全部收起");
  });

  await check("歌词：原生 details 折叠，展开后纯文本、保留换行、不解析 HTML，且请求索引中的 lyricsUrl", async () => {
    const before = requests.length;
    await page.click("details[data-lyrics] summary");
    await page.locator(".lyrics__text").waitFor();
    const text = await page.locator(".lyrics__text").evaluate((el) => el.textContent);
    expect(text.includes("<b>尖括号不应被解析为 HTML</b>"), "尖括号原样显示");
    expectEqual(await page.locator(".lyrics__text b").count(), 0, "不生成 b 元素");
    expect(text.includes("\n\n第二段"), "空行保留");
    expect(text.includes("&amp;"), "实体原样显示");
    const lyricsRequests = requests.slice(before).filter((item) => item.endsWith("lyrics.txt"));
    expectEqual(lyricsRequests, [`${BASE}content/works/fx-01-long-title/lyrics.txt`], "歌词请求路径");
    await shot(page, "work-lyrics-open");
  });

  await check("返回曲库：恢复搜索状态，浏览器后退/前进正常", async () => {
    await page.click("main .work__back a");
    await cards(page).first().waitFor();
    expect(page.url() === url("q=%E9%95%BF%E6%A0%87%E9%A2%98"), `返回 URL：${page.url()}`);
    expectEqual(await page.inputValue("[data-search]"), "长标题", "搜索词恢复");
    expectEqual(await cards(page).count(), 1, "结果恢复");
    await page.goBack();
    await page.locator("h1.work__title").waitFor();
    await page.goBack();
    await cards(page).first().waitFor();
    expectEqual(await page.inputValue("[data-search]"), "长标题", "后退到曲库恢复");
  });

  await check("人员继承：继承 / 替换 / 清除 / 新增角色；卡片只显示 1 个重点版本", async () => {
    await page.goto(url("q=%E4%BA%BA%E5%91%98%E7%BB%A7%E6%89%BF"));
    await cards(page).first().waitFor();
    expectEqual(await page.locator(".card[data-work='fx-07-people'] .version-names__item").allInnerTexts(), ["清除编曲并新增和声版（无日期）"], "单个重点版本");
    await page.goto(url("", "#/work/fx-07-people"));
    await page.locator("h1.work__title").waitFor();
    await page.click("[data-action='expand-all']");
    const rows = async (id) => page.locator(`details[data-version='${id}'] .people__row`).evaluateAll((list) => list.map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]));
    expectEqual(await rows("v-base"), [["演唱", "测试演唱者甲"], ["作词", "测试作词者乙"], ["作曲", "测试作曲者丙"], ["编曲", "测试编曲者丁"]], "完全继承");
    expectEqual(await rows("v-replace"), [["演唱", "测试演唱者庚、测试演唱者辛"], ["作词", "测试作词者乙"], ["作曲", "测试作曲者丙"], ["编曲", "测试编曲者丁"]], "替换演唱");
    expectEqual(await rows("v-clear"), [["演唱", "测试演唱者甲"], ["作词", "测试作词者乙"], ["作曲", "测试作曲者丙"], ["和声", "测试和声者壬"]], "清除编曲并新增和声");
    expectEqual(await page.locator("details[data-version='v-base'] time").innerText(), "2019", "仅年份");
    await page.click("details[data-lyrics] summary");
    await page.locator(".lyrics__text").waitFor();
    const text = await page.locator(".lyrics__text").evaluate((el) => el.textContent);
    expect(!text.includes("\r") && text.includes("第一行\n第二行"), "CRLF 归一为换行");
    await shot(page, "work-people-inheritance");
  });

  await check("最简作品：无封面占位、无人员、无歌词、年份未知、无链接版本", async () => {
    await page.goto(url("", "#/work/fx-03-minimal"));
    await page.locator("h1.work__title").waitFor();
    expectEqual(await page.locator(".work__cover .cover__placeholder").innerText(), "暂无封面", "封面占位");
    expect((await page.locator("section[aria-labelledby='people-heading']").innerText()).includes("暂无人员资料"), "无人员");
    expect((await page.locator("section[aria-labelledby='lyrics-heading']").innerText()).includes("暂未收录歌词"), "无歌词");
    expectEqual(await page.locator(".work__meta .year").innerText(), "年份未知", "年份未知");
    expectEqual(await page.locator(".work__aliases").count(), 0, "无别名不显示");
    expectEqual(await page.locator(".work__summary").count(), 0, "空简介不显示");
    expectEqual(await page.locator(".tags").count(), 0, "无标签不显示");
    await page.click("details[data-version='v-only'] summary");
    expectEqual(await page.locator("details[data-version='v-only'] .links").count(), 0, "无链接");
    await shot(page, "work-minimal");
  });

  await check("封面：损坏图片回退为文字占位；宽/竖图容器比例稳定", async () => {
    await page.goto(url("q=%E5%B0%81%E9%9D%A2"));
    await cards(page).first().waitFor();
    const broken = page.locator(".card[data-work='fx-04-broken-cover'] .cover__placeholder");
    await broken.waitFor();
    expectEqual(await broken.innerText(), "暂无封面", "损坏封面占位");
    const boxes = await page.locator(".card .cover").evaluateAll((list) => list.map((el) => Math.abs(el.getBoundingClientRect().width - el.getBoundingClientRect().height) < 1));
    expect(boxes.every(Boolean), `封面容器应为正方形：${JSON.stringify(boxes)}`);
    await page.waitForLoadState("networkidle");
    await shot(page, "home-covers");
    await page.goto(url("", "#/work/fx-04-broken-cover"));
    await page.locator(".work__cover .cover__placeholder").waitFor();
    await page.goto(url("", "#/work/fx-08-no-versions"));
    await page.locator("h1.work__title").waitFor();
    expect((await page.locator("section[aria-labelledby='versions-heading']").innerText()).includes("暂无版本资料"), "无版本作品");
  });

  await check("多链接版本：按数组顺序展示三条链接", async () => {
    await page.goto(url("", "#/work/fx-09-many-links"));
    await page.locator("h1.work__title").waitFor();
    await page.click("details[data-version='v-1'] summary");
    expectEqual(await page.locator(".links__item .links__platform").allInnerTexts(), ["示例平台A", "示例平台B", "示例平台C"], "链接顺序");
  });

  await check("错误状态：作品不存在 / 页面不存在", async () => {
    await page.goto(url("", "#/work/does-not-exist"));
    await page.locator(".notice").waitFor();
    expect((await page.locator(".notice__title").innerText()) === "作品不存在", `标题：${await page.locator(".notice__title").innerText()}`);
    await shot(page, "work-not-found");
    await page.click(".notice a");
    await cards(page).first().waitFor();
    await page.goto(url("", "#/whatever"));
    await page.locator(".notice").waitFor();
    expectEqual(await page.locator(".notice__title").innerText(), "页面不存在", "未知路由");
  });

  await check("错误状态：作品/版本/歌词/曲库加载失败均可重试恢复", async () => {
    const { context, page: fresh } = await newPage();
    await fresh.route("**/fx-09-many-links/work.json", (route) => route.abort());
    await fresh.goto(url("", "#/work/fx-09-many-links"));
    await fresh.locator(".notice--error").waitFor();
    expectEqual(await fresh.locator(".notice__title").innerText(), "作品加载失败", "作品失败");
    await shot(fresh, "work-load-error");
    await fresh.unroute("**/fx-09-many-links/work.json");
    await fresh.click("[data-action='retry']");
    await fresh.locator("h1.work__title").waitFor();
    expectEqual(await fresh.locator("h1.work__title").innerText(), "多链接测试曲", "重试后加载");

    await fresh.route("**/fx-04-broken-cover/version-v-2.json", (route) => route.abort());
    await fresh.goto(url("", "#/work/fx-04-broken-cover"));
    await fresh.locator(".version__error").waitFor();
    expect((await fresh.locator(".version__error .version__name").innerText()) === "版本二", "失败版本显示索引中的名称");
    expectEqual(await fresh.locator("details[data-version='v-1']").count(), 1, "其他版本正常");
    await shot(fresh, "work-version-error");
    await fresh.unroute("**/fx-04-broken-cover/version-v-2.json");
    await fresh.click("[data-action='retry-version']");
    await fresh.locator("details[data-version='v-2']").waitFor();

    await fresh.route("**/fx-04-broken-cover/lyrics.txt", (route) => route.abort());
    await fresh.click("details[data-lyrics] summary");
    await fresh.locator(".inline-error").waitFor();
    await fresh.unroute("**/fx-04-broken-cover/lyrics.txt");
    await fresh.click("[data-action='retry-lyrics']");
    await fresh.locator(".lyrics__text").waitFor();

    await fresh.route("**/works-index.json", (route) => route.abort());
    await fresh.goto(url());
    await fresh.locator(".notice--error").waitFor();
    expectEqual(await fresh.locator(".notice__title").innerText(), "曲库暂时无法加载", "曲库失败");
    await shot(fresh, "home-load-error");
    await fresh.unroute("**/works-index.json");
    await fresh.click("[data-action='retry']");
    await cards(fresh).first().waitFor();
    await context.close();
  });

  await check("键盘：可见焦点、Enter 进入详情、Space 展开版本不导航", async () => {
    await page.goto(url("q=%E9%95%BF%E6%A0%87%E9%A2%98"));
    await cards(page).first().waitFor();
    await page.keyboard.press("Tab");
    expectEqual(await page.evaluate(() => document.activeElement?.className), "skip-link", "第一个焦点是跳转链接");
    await page.locator("[data-search]").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle === "solid"), "搜索框键盘焦点应有可见轮廓");
    const chip = page.locator("input[name='tag']").first();
    await chip.focus();
    await page.keyboard.press("Space");
    expect(await chip.isChecked(), "Space 勾选标签");
    expect(await page.evaluate(() => getComputedStyle(document.activeElement.nextElementSibling).outlineStyle === "solid"), "标签键盘焦点应有可见轮廓");
    await page.keyboard.press("Space");
    await page.locator(".card__expand").first().focus();
    await page.keyboard.press("Space");
    expectEqual(await page.locator(".card__expand").first().getAttribute("aria-expanded"), "true", "Space 展开");
    expect(!page.url().includes("#/work"), "展开不导航");
    await page.locator(".card__link").first().focus();
    await shot(page, "home-focus-card", { fullPage: false });
    await page.keyboard.press("Enter");
    await page.locator("h1.work__title").waitFor();
  });

  await check("搜索防抖未落盘时立刻点击作品：详情 URL 正确，返回后搜索词保留", async () => {
    await page.goto(url());
    await cards(page).first().waitFor();
    await page.locator("[data-search]").fill("重点版本");
    await cards(page).locator(".card__link").first().click(); // 250ms 防抖内点击
    await page.locator("h1.work__title").waitFor();
    expect(page.url() === url("q=%E9%87%8D%E7%82%B9%E7%89%88%E6%9C%AC", "#/work/fx-02-featured"), `详情 URL：${page.url()}`);
    await page.reload();
    await page.locator("h1.work__title").waitFor();
    await page.goBack();
    await cards(page).first().waitFor();
    expectEqual(await page.inputValue("[data-search]"), "重点版本", "后退后搜索词保留");
    expectEqual(await cards(page).count(), 1, "结果集保留");
    // 详情页刷新过，回到首页属于冷加载：焦点保持在文档默认位置，Tab 的第一个目标仍是跳转链接
    await page.keyboard.press("Tab");
    expectEqual(await page.evaluate(() => document.activeElement?.className), "skip-link", "冷加载后第一个焦点是跳转链接");
    // 不刷新时从详情返回：焦点落在结果区
    await page.click(".card__link");
    await page.locator("h1.work__title").waitFor();
    await page.click("main .work__back a");
    await cards(page).first().waitFor();
    expectEqual(await page.evaluate(() => document.activeElement?.id), "catalog-results", "返回首页后焦点在结果区");
  });

  await check("从详情页点击标签进入新查询：从顶部开始而不是恢复旧滚动位置", async () => {
    await page.goto(url("page=2"));
    await cards(page).first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(700);
    // 点击当前视口内的卡片，避免驱动器为了点击而自动滚动
    const visibleLink = page.locator(".card__link").filter({ has: page.locator(":scope") }).nth(6);
    await visibleLink.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => window.scrollY);
    await visibleLink.click();
    await page.locator("h1.work__title").waitFor();
    expectEqual(await page.evaluate(() => document.activeElement?.tagName), "H1", "详情焦点在主标题");
    const chip = page.locator(".work__intro .chip--link").first();
    if (await chip.count()) {
      await chip.click();
      await cards(page).first().waitFor();
      expectEqual(await page.evaluate(() => window.scrollY), 0, "新查询从顶部开始");
    }
    await page.goBack();
    await page.locator("h1.work__title").waitFor();
    await page.goBack();
    await cards(page).first().waitFor();
    const after = await page.evaluate(() => window.scrollY);
    expect(before > 300 && Math.abs(after - before) < 5, `后退到原首页恢复滚动位置：before=${before} after=${after}`);
  });

  await check("刷新后恢复滚动位置；无效年份参数被归一为全部年份", async () => {
    await page.goto(url());
    await cards(page).first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(700);
    await page.reload();
    await cards(page).first().waitFor();
    await page.waitForTimeout(200);
    expect((await page.evaluate(() => window.scrollY)) > 500, `刷新后 scrollY=${await page.evaluate(() => window.scrollY)}`);
    await page.goto(url("year=1999"));
    await cards(page).first().waitFor();
    expectEqual(await cards(page).count(), 12, "无效年份不筛选");
    expectEqual(await page.inputValue("[data-year]"), "", "下拉显示全部年份");
  });

  await check("跳转链接：Enter 后焦点落在作品列表且不被滚动恢复覆盖", async () => {
    await page.goto(url("page=2"));
    await cards(page).first().waitFor();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expectEqual(await page.evaluate(() => document.activeElement?.id), "catalog-results", "焦点在作品列表");
    expect(await page.evaluate(() => window.scrollY > 0), "应滚动到作品列表而不是回到顶部");
    expect((await status(page)).includes("第 2 / 3 页"), "页码状态保持");
  });

  await check("减少动态效果：过渡时长被关闭", async () => {
    const { context, page: rm } = await newPage({ width: 1366, height: 900 }, { reducedMotion: "reduce" });
    await rm.goto(url());
    await cards(rm).first().waitFor();
    const duration = await rm.locator(".card").first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration !== "0.16s", `transition-duration=${duration}`);
    await context.close();
  });

  await check("手机 390px：无横向溢出，筛选面板可折叠，长标题/标签/展开版本不溢出", async () => {
    const { context, page: mobile } = await newPage({ width: 390, height: 844 });
    await mobile.goto(url());
    await cards(mobile).first().waitFor();
    expect(await noOverflow(mobile), "首页横向溢出");
    expectEqual(await mobile.locator("#filters-body").isVisible(), false, "筛选面板默认收起");
    await mobile.waitForLoadState("networkidle");
    await shot(mobile, "mobile-home");
    await mobile.click("[data-filters-toggle]");
    expectEqual(await mobile.locator("#filters-body").isVisible(), true, "筛选面板展开");
    await mobile.check("input[name='tag'][value='long-tag']");
    expectEqual(await mobile.locator("[data-filters-count]").innerText(), "1", "选中数量");
    expect(await noOverflow(mobile), "筛选后横向溢出");
    await shot(mobile, "mobile-filters-open");
    await mobile.goto(url("q=%E9%95%BF%E6%A0%87%E9%A2%98"));
    await cards(mobile).first().waitFor();
    await mobile.click(".card [data-action='toggle-versions']");
    expect(await noOverflow(mobile), "展开版本后横向溢出");
    expectEqual(await cardOverflow(mobile), [], "卡片内部溢出");
    await mobile.waitForLoadState("networkidle");
    await shot(mobile, "mobile-card-expanded");
    await mobile.click(".card__link");
    await mobile.locator("h1.work__title").waitFor();
    await mobile.click("[data-action='expand-all']");
    await mobile.click("details[data-lyrics] summary");
    await mobile.locator(".lyrics__text").waitFor();
    expect(await noOverflow(mobile), "详情横向溢出");
    expectEqual(await cardOverflow(mobile), [], "详情内部溢出");
    await mobile.waitForLoadState("networkidle");
    await shot(mobile, "mobile-work-expanded");
    await mobile.goto(url("", "#/work/fx-09-many-links"));
    await mobile.locator("h1.work__title").waitFor();
    await mobile.click("details[data-version='v-1'] summary");
    expect(await noOverflow(mobile), "长链接标签横向溢出");
    await shot(mobile, "mobile-work-links");
    await context.close();
  });

  await check("平板 820px：布局正常、无横向溢出", async () => {
    const { context, page: tablet } = await newPage({ width: 820, height: 1180 });
    await tablet.goto(url());
    await cards(tablet).first().waitFor();
    expect(await noOverflow(tablet), "平板横向溢出");
    await tablet.waitForLoadState("networkidle");
    await shot(tablet, "tablet-home");
    await tablet.goto(url("", "#/work/fx-01-long-title"));
    await tablet.locator("h1.work__title").waitFor();
    await tablet.click("[data-action='expand-all']");
    expect(await noOverflow(tablet), "平板详情横向溢出");
    await tablet.waitForLoadState("networkidle");
    await shot(tablet, "tablet-work");
    await context.close();
  });

  await check("桌面 1024px：侧栏布局临界点无溢出", async () => {
    const { context, page: mid } = await newPage({ width: 1024, height: 800 });
    await mid.goto(url());
    await cards(mid).first().waitFor();
    expect(await noOverflow(mid), "1024 横向溢出");
    await mid.waitForLoadState("networkidle");
    await shot(mid, "desktop-1024-home");
    await context.close();
  });
}

async function runEmpty() {
  const { page } = await newPage();
  await check("空曲库：正常状态而非错误", async () => {
    await page.goto(url());
    await page.locator(".empty").waitFor();
    expect((await page.locator("h1").innerText()).includes("泠鸢yousa"), "站名");
    expectEqual(await page.locator(".empty__title").innerText(), "曲库暂无作品", "空状态标题");
    expectEqual(await page.locator(".notice--error").count(), 0, "不应显示错误");
    expectEqual(await page.locator("[data-filters]").isVisible(), false, "无标签配置时隐藏筛选面板");
    expectEqual(await page.locator("[data-pagination]").innerText(), "", "无分页");
    expect((await page.locator("footer").innerText()).includes("非官方"), "非官方说明");
    await shot(page, "home-empty");
  });
  await check("空曲库：请求路径与 BASE 一致", async () => {
    const content = requests.filter((item) => item.includes("/content/"));
    expectEqual(content.filter((item) => !item.startsWith(`${BASE}content/`)), [], "越出基址的请求");
  });
  await check("空曲库：详情不存在状态", async () => {
    await page.goto(url("", "#/work/anything"));
    await page.locator(".notice").waitFor();
    expectEqual(await page.locator(".notice__title").innerText(), "作品不存在", "不存在");
  });
  await check("空曲库：手机布局", async () => {
    const { context, page: mobile } = await newPage({ width: 390, height: 844 });
    await mobile.goto(url());
    await mobile.locator(".empty").waitFor();
    expect(await noOverflow(mobile), "横向溢出");
    await shot(mobile, "mobile-home-empty");
    await context.close();
  });
}
