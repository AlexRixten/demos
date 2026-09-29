// E2E живого стенда triage: клики по пресетам, проверка DOM-результата.
import { chromium } from "playwright";

const check = async (page, key) => {
  await page.click(`.presets button[data-k="${key}"]`);
  await page.click("#classify");
  await page.waitForFunction(() => {
    const c = document.querySelector("#conf-val")?.textContent;
    return c && c !== "—" && !c.startsWith("⏱");
  }, { timeout: 15000 });
  await page.waitForTimeout(1800); // долигают анимации баров/маршрута
  return page.evaluate(() => ({
    billing: document.querySelector("#bv-billing")?.textContent,
    technical: document.querySelector("#bv-technical")?.textContent,
    conf: document.querySelector("#conf-val")?.textContent,
    refund: document.querySelector("#refund-val")?.textContent,
    ms: document.querySelector("#ms")?.textContent,
    route: document.querySelector("#journal tbody tr td.rt")?.textContent,
  }));
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:5177", { waitUntil: "networkidle" });
console.log("режим-плашка:", await page.textContent("#mode-pill"));

for (const key of ["billing", "vague", "happy"]) {
  const r = await check(page, key);
  console.log(`[${key}]`, JSON.stringify(r));
}
await browser.close();
