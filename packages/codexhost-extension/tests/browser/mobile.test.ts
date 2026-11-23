import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type CDPSession } from "playwright-core";
import { mockUI } from "../ui-host";

async function swipeUp(cdp: CDPSession, x: number, y: number) {
  for (let i = 0; i < 9; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: i ? "touchMove" : "touchStart",
      touchPoints: [{ x, y: y - i * 25 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("the Web panel scrolls by touch inside a fixed host, including after rotation", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const cdp = await page.context().newCDPSession(page);
  const { api } = mockUI();
  const longName = "workspace".repeat(24);
  await page.exposeFunction("invoke", async (method: string, params: object) => {
    if (method === "althing/codexhost/projects")
      return { projects: [{ cwd: "/" + longName, name: longName }] };
    const result = await api.backend.invoke(method, params);
    if (method === "althing/topics/list" && Array.isArray(result))
      return result.map((card) => ({ ...card, subtitle: longName }));
    return result;
  });
  await page.route("http://mobile.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== "/") {
      await route.fulfill({ path: "dist" + path });
      return;
    }
    await route.fulfill({ contentType: "text/html", body: `<!doctype html>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{margin:0;height:100dvh;overflow:hidden;display:flex;flex-direction:column}
      header{height:48px;flex:none}main{flex:1;min-height:0;overflow:hidden}</style>
      <header>Host</header><main></main><script type="module">
      import {activate} from '/web/index.mjs';
      const signal = new AbortController().signal;
      await activate({signal,locale:'en',assets:{url:p=>'/'+p},backend:{invoke:window.invoke},
        storage:{get:async()=>({}),onChange:()=>()=>{}},track(){},
        panels:{register(panel){panel.render(document.querySelector('main'),signal);return ()=>{}}}});
      </script>` });
  });
  await page.goto("http://mobile.test/");
  const root = page.locator(".althing-ext-root");
  const enter = root.getByRole("button", { name: "Enter council" });
  await enter.last().waitFor();
  assert.equal(await root.evaluate(el => el.clientHeight), 520);
  assert.equal(await root.evaluate(el => el.scrollWidth), 320);
  assert.ok((await enter.first().boundingBox())!.width > 200);
  assert.equal(await root.getByLabel("Theme").evaluate(el => getComputedStyle(el).opacity), "1");
  for (let i = 0; i < 12; i++) {
    if (await root.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop <= 2)) break;
    await swipeUp(cdp, 140, 450);
    await page.waitForTimeout(100);
  }
  assert.ok((await enter.last().boundingBox())!.y < 568);
  assert.ok(await root.evaluate(el => el.scrollTop > 0 && el.scrollHeight - el.clientHeight - el.scrollTop <= 2));
  assert.equal(await page.evaluate(() => document.scrollingElement!.scrollTop), 0);
  await enter.first().tap();
  await root.locator(".venue-door").first().waitFor();
  assert.equal(await root.evaluate(el => el.scrollTop), 0);
  await root.locator(".venue-door").first().tap();
  await root.getByRole("button", { name: "Reading view" }).tap();
  await page.setViewportSize({ width: 667, height: 375 });
  assert.equal(await root.evaluate(el => el.clientHeight), 327);
  assert.equal(await root.evaluate(el => el.scrollWidth), 667);
  await root.getByRole("button", { name: "Councils", exact: true }).tap();
  await root.getByRole("button", { name: "New Council" }).tap();
  const dialog = root.getByRole("dialog");
  await dialog.waitFor();
  const box = (await dialog.boundingBox())!;
  const background = await root.evaluate(el => el.scrollTop);
  await swipeUp(cdp, box.x + 25, box.y + box.height - 15);
  await page.waitForFunction(el => el && el.scrollTop > 0, await dialog.elementHandle());
  assert.equal(await root.evaluate(el => el.scrollTop), background);
  assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
});
