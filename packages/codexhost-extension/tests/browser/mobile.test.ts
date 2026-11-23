import test from "node:test";
import assert from "node:assert/strict";
import {
  chromium,
  webkit,
  type Page,
  type Locator,
  type CDPSession,
} from "playwright-core";
import { readFile } from "node:fs/promises";
import { councilFixture } from "../helpers";
import { hydrate } from "../../src/backend/domain/council";
import { mockUI } from "../ui-host";

async function openWebPanel(page: Page) {
  await page.route("http://mobile.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== "/") {
      await route.fulfill({ path: "dist" + path });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{margin:0;height:100dvh;overflow:hidden;display:flex;flex-direction:column}
      header{height:48px;flex:none}main{flex:1;min-height:0;overflow:hidden}</style>
      <header>Host</header><main></main><script type="module">
      import {activate} from '/web/index.mjs';
      const signal = new AbortController().signal;
      await activate({signal,locale:'en',assets:{url:p=>'/'+p},backend:{invoke:window.invoke},
        storage:{get:async()=>({}),onChange:()=>()=>{}},track(){},
        panels:{register(panel){panel.render(document.querySelector('main'),signal);return ()=>{}}}});
      </script>`,
    });
  });
  await page.goto("http://mobile.test/");
}

async function swipeUp(cdp: CDPSession, x: number, y: number) {
  for (let i = 0; i < 9; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: i ? "touchMove" : "touchStart",
      touchPoints: [{ x, y: y - i * 25 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("the Web panel scrolls by touch inside a fixed host, including after rotation", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  const cdp = await page.context().newCDPSession(page);
  const { api } = mockUI();
  const longName = "workspace".repeat(24);
  await page.exposeFunction(
    "invoke",
    async (method: string, params: object) => {
      if (method === "althing/codexhost/projects")
        return { projects: [{ cwd: "/" + longName, name: longName }] };
      const result = await api.backend.invoke(method, params);
      if (method === "althing/topics/list" && Array.isArray(result))
        return result.map((card) => ({ ...card, subtitle: longName }));
      return result;
    },
  );
  await openWebPanel(page);
  const root = page.locator(".althing-ext-root");
  const enter = root.getByRole("button", { name: "Enter council" });
  await enter.last().waitFor();
  assert.equal(await root.evaluate((el) => el.clientHeight), 520);
  assert.equal(await root.evaluate((el) => el.scrollWidth), 320);
  assert.ok((await enter.first().boundingBox())!.width > 200);
  assert.equal(
    await root
      .getByLabel("Theme")
      .evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  for (let i = 0; i < 12; i++) {
    if (
      await root.evaluate(
        (el) => el.scrollHeight - el.clientHeight - el.scrollTop <= 2,
      )
    )
      break;
    await swipeUp(cdp, 140, 450);
    await page.waitForTimeout(100);
  }
  assert.ok((await enter.last().boundingBox())!.y < 568);
  assert.ok(
    await root.evaluate(
      (el) =>
        el.scrollTop > 0 &&
        el.scrollHeight - el.clientHeight - el.scrollTop <= 2,
    ),
  );
  assert.equal(
    await page.evaluate(() => document.scrollingElement!.scrollTop),
    0,
  );
  await enter.first().tap();
  await root.getByRole("heading", { name: "Council brief" }).waitFor();
  assert.equal(await root.evaluate((el) => el.scrollTop), 0);
  await root.locator(".agenda-link").first().tap();
  await page.setViewportSize({ width: 667, height: 375 });
  assert.equal(await root.evaluate((el) => el.clientHeight), 327);
  assert.equal(await root.evaluate((el) => el.scrollWidth), 667);
  await root.getByRole("button", { name: "Councils", exact: true }).tap();
  await root.getByRole("button", { name: "New Council" }).tap();
  const dialog = root.getByRole("dialog");
  await dialog.waitFor();
  const box = (await dialog.boundingBox())!;
  const background = await root.evaluate((el) => el.scrollTop);
  await swipeUp(cdp, box.x + 25, box.y + box.height - 15);
  await page.waitForFunction(
    (el) => el && el.scrollTop > 0,
    await dialog.elementHandle(),
  );
  assert.equal(await root.evaluate((el) => el.scrollTop), background);
  assert.ok(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
});

const longCell =
  "周末借阅服务会随读者到馆时间而变化，需要分时段记录并核对观察结果。".repeat(
    5,
  );
const wideMarkdown = [
  "| 观测地点 | 时段 | 指标 | 观察结论 | 下次复核 |",
  "| --- | --- | --- | --- | --- |",
  "| 河畔书屋 | 周日下午 | 借阅频次 | " + longCell + " | 下月初 |",
].join("\n");

async function verifyScrollRegion(
  page: Page,
  region: Locator,
  cdp: CDPSession | null,
  label: string,
) {
  await region.scrollIntoViewIfNeeded();
  const data = await region.evaluate((el) => {
    const widths = Array.from(
      el.querySelectorAll("td,th"),
      (cell) => cell.getBoundingClientRect().width,
    );
    const long = Array.from(el.querySelectorAll("td")).find(
      (cell) => cell.textContent.length > 80,
    )!;
    const longWidth = long.getBoundingClientRect().width;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(long);
    const lines = new Set(
      Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
    ).size;
    return {
      min: Math.min(...widths),
      max: Math.max(...widths),
      longWidth,
      lines,
      viewport: el.clientWidth,
      content: el.scrollWidth,
    };
  });
  assert.ok(data.min >= 115 && data.max <= 380, JSON.stringify(data));
  assert.ok(
    data.lines > 1,
    "Long Chinese text must occupy multiple horizontal lines",
  );
  assert.ok(data.content > data.viewport);
  if (!label.endsWith("roster"))
    assert.ok(
      data.longWidth >= 260 && data.longWidth <= 340,
      JSON.stringify(data),
    );
  await region.evaluate((el) =>
    el.scrollIntoView({ block: "center", inline: "nearest" }),
  );
  const point = await region.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    const doc = el.getRootNode() as Document | ShadowRoot;
    const x = bounds.left + el.clientWidth * 0.84;
    for (
      let y = Math.max(1, bounds.top + 30);
      y < Math.min(bounds.bottom, el.ownerDocument.defaultView!.innerHeight);
      y += 12
    ) {
      const hit = doc.elementFromPoint(x, y);
      if (hit && el.contains(hit))
        return { x: x - bounds.left, y: y - bounds.top };
    }
    throw Error("No visible touch target inside the scroll region");
  });
  const box = (await region.boundingBox())!;
  if (cdp) {
    for (let i = 0; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: i ? "touchMove" : "touchStart",
        touchPoints: [
          { x: box.x + point.x - i * box.width * 0.075, y: box.y + point.y },
        ],
      });
      await page.waitForTimeout(22);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    // Playwright exposes native swipe injection via CDP. Also check WebKit's scroll layout.
    await region.evaluate((el) => el.scrollBy(150, 0));
  }
  const left = await region.evaluate((el) => el.scrollLeft);
  assert.ok(left > 0, label + " did not scroll");
  console.log(label, { ...data, scrollLeft: left });
}

for (const engine of [chromium, webkit]) {
  for (const width of [320, 375]) {
    test(
      engine.name() +
        " " +
        width +
        "px reading, roster, discussion, new and legacy reports",
      async (t) => {
        const browser = await engine.launch();
        t.after(() => browser.close());
        const page = await browser.newPage({
          viewport: { width, height: 812 },
          isMobile: true,
          hasTouch: true,
        });
        const cdp =
          engine === chromium ? await page.context().newCDPSession(page) : null;
        const errors: string[] = [];
        page.on("console", (msg) => {
          if (
            /content.security.policy|violates.*directive|refused to (?:execute|apply)/i.test(
              msg.text(),
            )
          )
            errors.push(msg.text());
        });
        page.on("pageerror", (e) => errors.push(e.message));
        const c = councilFixture();
        c.patch("topic", "study", { status: "completed" });
        const reports = ["New report", "Legacy report"].map((title, i) =>
          c.create(
            "report",
            { id: "r" + i, title, markdown_content: wideMarkdown },
            "study",
          ),
        );
        const legacy = reports[1];
        legacy.html_content = legacy
          .html_content!.replace(
            /<style data-althing-mobile-tables>[\s\S]*?<\/style>/,
            "<style>.body table{display:block;overflow:auto}.body td{overflow-wrap:anywhere}</style>",
          )
          .replace(
            '<div class="table-scroll" role="region" tabindex="0"><table>',
            "<table>",
          )
          .replace("</table></div>", "</table>");
        assert.ok(!legacy.html_content.includes("table-scroll"));
        const topic = hydrate(c.tree);
        topic.panelists[0].role = longCell;
        topic.agendas[0].conclusion_summary = "延长服务时段后复核到访量。";
        topic.agendas[0].open_disagreements = ["是否延长上午的服务？"];
        topic.agendas[0].report_id = reports[0].id;
        topic.agendas[0].sub_agendas[0].prompt_framing = wideMarkdown;
        const { api } = mockUI();
        await page.exposeFunction(
          "invoke",
          (method: string, params: { reportId?: string }) => {
            if (method.endsWith("/topics/get")) return topic;
            if (method.endsWith("/reports/get"))
              return reports.find((r) => r.id === params.reportId);
            return api.backend.invoke(method, params);
          },
        );
        await openWebPanel(page);
        const root = page.locator(".althing-ext-root");
        await root.getByRole("button", { name: "Enter council" }).first().tap();
        await root.getByRole("heading", { name: "Council brief" }).waitFor();
        assert.equal(
          await root.locator(".venue-door, .council-view-switch").count(),
          0,
        );
        assert.equal(
          await root.getByText(/^(Venue view|会场模式)$/).count(),
          0,
        );
        const card = root.locator(".conclusion-cards > li").first();
        await card.getByText("Conclusions and findings").waitFor();
        assert.ok(await card.getByText("是否延长上午的服务？").isVisible());
        assert.ok(
          await card.getByRole("button", { name: "Read report" }).isVisible(),
        );
        assert.equal(await root.locator(".conclusion-matrix").count(), 0);
        assert.ok((await card.boundingBox())!.width > width * 0.8);
        await root
          .getByRole("button", { name: "Expert roster", exact: true })
          .tap();
        const label = engine.name() + " " + width;
        await verifyScrollRegion(
          page,
          root.locator(".table-scroll:has(.roster-table)"),
          cdp,
          label + " roster",
        );
        const fits = () =>
          root.evaluate((el) => el.scrollWidth === el.clientWidth);
        assert.ok(await fits());
        await root.getByLabel("Choose agenda").tap();
        await root.locator(".council-agenda-list button").first().tap();
        await verifyScrollRegion(
          page,
          root.locator(".discussion .prose .table-scroll").first(),
          cdp,
          label + " discussion",
        );
        assert.ok(await fits());
        await root
          .getByRole("button", { name: "Final reports", exact: true })
          .tap();
        for (const report of reports) {
          await root
            .getByRole("button", {
              name: report.title + " · v" + report.version,
            })
            .tap();
          const dialog = root.getByRole("dialog");
          const iframe = dialog.locator(".report-frame");
          const inner = iframe.contentFrame();
          const table = inner.locator(".table-scroll");
          await table.waitFor();
          const frameBox = (await iframe.boundingBox())!;
          assert.ok(
            frameBox.width >= width - 16 && frameBox.height >= 812 * 0.76,
            JSON.stringify(frameBox),
          );
          const background = await root.evaluate((el) => el.scrollTop);
          await verifyScrollRegion(
            page,
            table,
            cdp,
            label + " " + report.title,
          );
          assert.ok(
            await inner
              .locator("html")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          );
          assert.equal(await root.evaluate((el) => el.scrollTop), background);
          assert.ok(await fits());
          await page.emulateMedia({ media: "print" });
          assert.ok(
            await table.evaluate(
              (el) =>
                getComputedStyle(el).overflowX === "visible" &&
                el.scrollWidth <= el.clientWidth + 2,
            ),
            "Print layout clips table columns",
          );
          await page.emulateMedia({ media: "screen" });
          await inner.locator("[data-mode]").tap();
          assert.ok(await inner.locator("html[data-dark]").count());
          if (report === legacy && engine === chromium) {
            const pending = page.waitForEvent("download");
            await dialog.getByRole("button", { name: "Download HTML" }).tap();
            const html = await readFile(
              (await (await pending).path())!,
              "utf8",
            );
            assert.match(html, /<style data-althing-mobile-tables>/);
            assert.match(
              html,
              /<div class="table-scroll" role="region" tabindex="0"><table>/,
            );
          }
          await dialog
            .getByRole("button", { name: "Close", exact: true })
            .tap();
        }
        await page.setViewportSize({ width: 1100, height: 812 });
        await root.getByRole("button", { name: "Overview", exact: true }).tap();
        await root.locator(".conclusion-matrix").waitFor();
        assert.equal(await root.locator(".conclusion-cards").count(), 0);
        assert.ok(
          await root
            .locator(".conclusion-matrix th")
            .evaluateAll((es) =>
              es.every((e) => e.getBoundingClientRect().width >= 115),
            ),
        );
        assert.deepEqual(errors, []);
      },
    );
  }
}
