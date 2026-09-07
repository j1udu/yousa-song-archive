import { chromium } from "playwright-core";
const target = process.argv[2] ?? "http://localhost:4174/yousa-song-archive/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
await page.goto(target);
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const w = window.innerWidth;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > w + 0.5 || r.left < -0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} left=${r.left.toFixed(1)} right=${r.right.toFixed(1)} width=${r.width.toFixed(1)}`);
  }
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth: w, out: out.slice(0, 25) };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
