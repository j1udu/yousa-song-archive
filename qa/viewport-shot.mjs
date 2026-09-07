import { chromium } from "playwright-core";
const [target, out, w = "390", h = "844", action = ""] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: Number(w), height: Number(h) } })).newPage();
await page.goto(target);
await page.waitForTimeout(600);
if (action === "filters") await page.click("[data-filters-toggle]");
if (action === "expand") { await page.click("[data-action='expand-all']"); }
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
