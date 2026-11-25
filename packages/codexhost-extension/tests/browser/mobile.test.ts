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
import { measureBounds } from "./bounds";
import { councilFixture, contribution, dispatch } from "../helpers";
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
      await activate({signal,onLocaleChange(fn){const cb=e=>fn(e.detail);document.addEventListener('host-locale',cb);return ()=>document.removeEventListener('host-locale',cb)},assets:{url:p=>'/'+p},backend:{invoke:window.invoke},
        storage:{get:async()=>({}),onChange(fn){const cb=e=>fn(e.detail);document.addEventListener('plugin-settings',cb);return ()=>document.removeEventListener('plugin-settings',cb)}},track(){},
        dom:{mount(parent){const container=document.createElement('div');parent.append(container);return {container,dispose:()=>container.remove()}}},
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
        await root
          .getByRole("button", { name: "Expert roster", exact: true })
          .and(root.locator('[aria-current="page"]'))
          .waitFor();
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

const longTitle =
  "社区观察 · " +
  "QuarterlyReview".repeat(8) +
  "与下一阶段公共服务的跨区域评估";

for (const engine of [chromium, webkit]) {
  for (const width of [320, 375, 480]) {
    test(
      engine.name() +
        " " +
        width +
        "px keeps long content and menus inside their frames",
      async (t) => {
        const browser = await engine.launch();
        t.after(() => browser.close());
        const page = await browser.newPage({
          viewport: { width, height: 812 },
          isMobile: true,
          hasTouch: true,
        });
        page.setDefaultTimeout(6000);
        const c = councilFixture();
        c.create("dispatch", { ...dispatch, title: longTitle }, "s");
        c.create(
          "contribution",
          {
            ...contribution,
            summary: longTitle,
            full_content:
              "排版<br />换行<sup>2</sup><sub>3</sub><wbr><u>线</u><mark>记</mark><b>粗</b><i>斜</i><s>删</s>\n\n" +
              wideMarkdown +
              "\n\n```\n" +
              "example".repeat(180) +
              "\n```",
          },
          "s",
        );
        const shortTables =
          "| 地点 | 时间 |\n| --- | --- |\n| 书屋 | 周六 |\n\n| 地点 | 时间 | 活动 |\n| --- | --- | --- |\n| 公园 | 周日 | 阅读 |";
        const reports = [1, 2].map((i) =>
          c.create(
            "report",
            { title: longTitle + i, markdown_content: shortTables },
            "study",
          ),
        );
        // A stored 1.0.2 report already has scroll regions, but its short tables did not fill them.
        reports[1].html_content = reports[1].html_content!.replace(
          "min-width: 100%; border-collapse",
          "border-collapse",
        );
        const topic = hydrate(c.tree);
        topic.title =
          topic.agendas[0].title =
          topic.agendas[0].sub_agendas[0].title =
            longTitle;
        topic.panelists[0].name = longTitle;
        topic.archives = [1, 2].map((i) => ({
          id: "archive" + i,
          title: longTitle + i,
          topic_id: topic.id,
          format: "zip",
          file_name: "archive.zip",
          file_size_bytes: 10,
          sha256: "a".repeat(64),
          created_at: new Date(0).toISOString(),
          metadata: {},
          download_url: "",
          preview_url: "",
        }));
        const { api } = mockUI();
        await page.exposeFunction(
          "invoke",
          async (
            method: string,
            params: { topicId?: string; reportId?: string },
          ) => {
            if (method.endsWith("/topics/get"))
              return {
                ...topic,
                id: params.topicId,
                status:
                  params.topicId === "other" ? "completed" : "in_progress",
              };
            if (method.endsWith("/reports/get"))
              return reports.find((r) => r.id === params.reportId);
            const result = await api.backend.invoke(method, params);
            if (method.endsWith("/topics/list") && Array.isArray(result))
              return result.map((r) => ({ ...r, title: longTitle }));
            if (method.endsWith("/council/runs") && Array.isArray(result))
              return result.map((r) => ({
                ...r,
                model: longTitle,
                progressText: "https://example.test/" + "reading".repeat(45),
              }));
            return result;
          },
        );
        await openWebPanel(page);
        const root = page.locator(".althing-ext-root"),
          dialog = root.getByRole("dialog");
        const check = async (stage: string) => {
          const { boxes, problems } = await root.evaluate(measureBounds, width);
          assert.ok(boxes > 0, stage);
          assert.deepEqual(
            problems,
            [],
            stage + ": " + JSON.stringify(problems),
          );
        };
        async function menuFits(selector: string, anchor: string) {
          const menu = root.locator(selector);
          await menu.waitFor();
          const m = (await menu.boundingBox())!,
            a = (await root.locator(anchor).boundingBox())!;
          assert.ok(
            Math.abs(a.x - m.x) <= 1 && Math.abs(a.width - m.width) <= 1,
            selector,
          );
          await check(selector);
        }
        const enter = root.getByRole("button", { name: "Enter council" });
        await enter.last().waitFor();
        await check("hub");
        await root.getByRole("button", { name: "New Council" }).tap();
        await dialog.getByLabel("Title", { exact: true }).fill(longTitle);
        await check("wizard quick convene");
        await dialog.locator(".customize-drawer > summary").tap();
        await check("wizard details");
        await dialog.getByRole("button", { name: /Add expert/ }).tap();
        const addCollab = dialog.getByRole("button", {
          name: "Add collaboration experts",
        });
        if (await addCollab.isEnabled()) await addCollab.tap();
        await check("wizard roster");
        await dialog
          .getByRole("button", { name: /Remove expert/ })
          .last()
          .tap();
        await dialog
          .getByLabel("Ask the moderator to propose agendas and sub-agendas")
          .tap();
        await dialog.getByRole("button", { name: /Add agenda/ }).tap();
        await dialog
          .getByRole("button", { name: /Add sub-agenda/ })
          .last()
          .tap();
        await check("wizard agenda");
        const close = dialog.getByRole("button", {
          name: "Close",
          exact: true,
        });
        await close.tap();
        await enter.first().tap();
        await root.locator(".agenda-line").waitFor();
        await root.locator(".run-card").waitFor();
        await check("active overview, archive and report buttons");
        await root.locator(".action-menu summary").tap();
        await menuFits(".action-menu > .tools", ".council-breadcrumb");
        await root.locator(".action-menu").getByRole("button",{name:"Configure roles & agents"}).tap();
        await dialog.getByRole("button",{name:"Refresh list"}).waitFor();
        await dialog.getByRole("option",{name:/Codex · High/}).first().waitFor({state:"attached"});
        await check("existing roster editor and collaboration agents");
        await dialog.getByRole("button",{name:"Cancel",exact:true}).tap();
        if (!await root.locator(".action-menu").evaluate(el=>el.hasAttribute("open"))) await root.locator(".action-menu summary").tap();
        await root.locator(".action-menu summary").tap();
        await root.getByLabel("Choose agenda").tap();
        await menuFits(".council-agenda-list", ".council-navigation");
        await root.locator(".council-agenda-list button").first().tap();
        await root.locator(".response .fold > button").tap();
        await root.locator(".response pre").waitFor();
        for (const tag of [
          "br",
          "sup",
          "sub",
          "wbr",
          "u",
          "mark",
          "b",
          "i",
          "s",
        ])
          assert.equal(
            await root.locator(".response .reveal " + tag).count(),
            1,
            tag,
          );
        await root.locator(".response .table-scroll").waitFor();
        await check("sub-agenda and expanded full text");
        await root.getByRole("button", { name: "Dispatch round" }).tap();
        await dialog.locator("select").first().selectOption("critique");
        await dialog.getByText(longTitle, { exact: false }).last().waitFor();
        await check("dispatch with long critique target");
        await close.tap();
        await root.getByRole("button", { name: "Update sub-agenda" }).tap();
        await dialog.waitFor();
        await check("quick edit");
        await close.tap();
        await root.getByRole("button", { name: "Councils", exact: true }).tap();
        await enter.last().tap();
        await root.locator(".report-index").waitFor();
        await check("completed overview and report index");
        if (width === 375) {
          await page.setViewportSize({ width: 1280, height: 900 });
          for (const [index, report] of reports.entries()) {
            await root.locator(".report-index button").nth(index).click();
            const regions = dialog
              .locator("iframe")
              .contentFrame()
              .locator(".table-scroll");
            await regions.first().waitFor();
            const sizes = await regions.evaluateAll((es) =>
              es.map((el) => [
                el.clientWidth,
                el.querySelector("table")!.getBoundingClientRect().width,
              ]),
            );
            assert.equal(sizes.length, 2, report.id);
            assert.ok(
              sizes.every(
                ([box, table]) => box >= 600 && Math.abs(box - table) <= 1,
              ),
              JSON.stringify(sizes),
            );
            console.log(
              engine.name(),
              "desktop short tables, report",
              index + 1,
              sizes,
            );
            await close.click();
          }
        }
      },
    );
  }
}

for (const engine of [chromium, webkit]) {
  test(
    engine.name() +
      " mobile chat opens a council by slash hint or Enter and consumes only the command",
    async (t) => {
      const browser = await engine.launch();
      t.after(() => browser.close());
      const page = await browser.newPage({
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      });
      await page.exposeFunction("invoke", mockUI().api.backend.invoke);
      await openWebPanel(page);
      await page.locator(".althing-ext-root").waitFor();
      await page.evaluate(() => {
        const host = document.querySelector("header")!;
        host.dataset.composerCard = "";
        host.innerHTML =
          '<div contenteditable="true" role="textbox" data-composer-input></div>';
      });
      const editor = page.locator("[data-composer-input]");
      const workspace = page.locator("[data-althing-web-workspace]");
      // Prefix hint opens 1-screen Quick Convene dialog with zero bounds overflow
      await editor.fill("/alt");
      await page.getByRole("button", { name: /\/althing/ }).tap();
      await workspace.getByRole("dialog").waitFor();
      assert.equal(
        await workspace.getByLabel("Title", { exact: true }).inputValue(),
        "",
      );
      assert.equal((await editor.innerText()).trim(), "");
      const dialogBounds = await workspace
        .locator(".althing-ext-root")
        .evaluate(measureBounds, 375);
      assert.deepEqual(dialogBounds.problems, []);
      await workspace.getByLabel("Close", { exact: true }).tap();
      await workspace.getByRole("button", { name: "Back to chat" }).tap();
      await workspace.waitFor({ state: "detached" });

      // /althing <topic> + Enter directly convenes and opens the live Council page (no dialog!)
      await editor.fill("/althing 通勤研究");
      await editor.press("Enter");
      await workspace
        .getByRole("heading", { name: "通勤研究", level: 1 })
        .waitFor();
      assert.equal(await workspace.getByRole("dialog").count(), 0);
      assert.equal((await editor.innerText()).trim(), "");
      const liveBounds = await workspace
        .locator(".althing-ext-root")
        .evaluate(measureBounds, 375);
      assert.deepEqual(liveBounds.problems, []);
      await workspace.getByRole("button", { name: "Back to chat" }).tap();
      await workspace.waitFor({ state: "detached" });
    },
  );
}

for (const engine of [chromium, webkit]) {
  test(
    engine.name() +
      " switches language in an open workspace and composer with a Chinese browser",
    async (t) => {
      const browser = await engine.launch();
      t.after(() => browser.close());
      const page = await browser.newPage({
        locale: "zh-CN",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      });
      const { api } = mockUI();
      await page.exposeFunction("invoke", (method: string, p: object) =>
        api.backend.invoke(method, p),
      );
      await openWebPanel(page);
      const root = page.locator(".althing-ext-root");
      await root.getByRole("button", { name: "New Council" }).waitFor();
      assert.equal(await root.getAttribute("lang"), "en");
      await page.evaluate(() => {
        const composer = document.createElement("form");
        composer.setAttribute("data-composer-card", "");
        composer.innerHTML =
          '<textarea></textarea><button aria-label="보내기"></button>';
        document.body.prepend(composer);
        const input = composer.querySelector("textarea")!;
        input.value = "/althing";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.documentElement.lang = "zh-Hant-HK";
      });
      await root.getByRole("button", { name: "新建議題" }).waitFor();
      const cases = [
        ["en", "New Council", "Start a council"],
        ["zh-CN", "新建议题", "发起会议"],
        ["zh-TW", "新建議題", "發起會議"],
        ["ja", "新しい会議", "会議を開く"],
        ["ko", "새 회의", "회의 시작"],
      ];
      for (const [tag, name, hint] of cases) {
        await page.evaluate(
          (tag) =>
            document.dispatchEvent(
              new CustomEvent("host-locale", { detail: tag }),
            ),
          tag,
        );
        await root.getByRole("button", { name, exact: true }).waitFor();
        await page
          .getByRole("button", { name: "/althing · " + hint })
          .waitFor();
        assert.equal(await root.getAttribute("lang"), tag);
        assert.ok(
          await root.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        );
      }
      await page.evaluate(() =>
        document.dispatchEvent(
          new CustomEvent("plugin-settings", { detail: { language: "en" } }),
        ),
      );
      await root.getByRole("button", { name: "New Council" }).waitFor();
      await page.evaluate(() =>
        document.dispatchEvent(
          new CustomEvent("plugin-settings", { detail: { language: "auto" } }),
        ),
      );
      await root.getByRole("button", { name: "새 회의" }).waitFor();
      await page
        .locator("[data-composer-card] button[aria-label]")
        .dispatchEvent("click");
      await page
        .locator("[data-althing-web-workspace]")
        .getByRole("dialog")
        .waitFor();
      assert.equal(await page.locator("[data-althing-web-workspace] .althing-ext-root").getAttribute("lang"),"ko");

    },
  );
}

test("chromium embedded Codex Desktop (26.1120): sidebar placement below New chat & Bot, project councils, and ProseMirror /althing floating pill", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const desktopJs = await readFile("dist/desktop/index.js", "utf8");
  const desktopCss = await readFile("dist/desktop/style.css", "utf8");
  const { api } = mockUI();
  await page.exposeFunction("invoke", async (method: string, params: any) => {
    if (method === "althing/codexhost/projects") {
      return {
        projects: [{ cwd: "/projects/study", name: "Study" }],
        total: 1,
        nextOffset: null,
      };
    }
    if (method === "althing/codexhost/threads") {
      return {
        threads: [
          { thread: "codex://threads/thread-study-1", cwd: "/projects/study" },
        ],
      };
    }
    return api.backend.invoke(method, params);
  });
  await page.exposeFunction("readDataUrl", async () =>
    api.assets.readDataUrl!(),
  );
  await page.setContent(`<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <style>
          body { margin: 0; display: flex; height: 100vh; font: 14px/1.4 system-ui, sans-serif; }
          aside { width: 260px; flex: none; display: flex; flex-direction: column; padding: 10px; box-sizing: border-box; border-right: 1px solid #ddd; }
          .top-nav { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
          .top-nav > button { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; text-align: start; font: inherit; }
          [data-app-action-sidebar-scroll] { flex: 1; overflow: auto; }
          main { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; padding: 24px; }
          [data-codex-composer-root] { border: 1px solid #ccc; border-radius: 14px; padding: 12px; overflow: hidden; display: flex; align-items: center; gap: 8px; }
          .ProseMirror { flex: 1; min-height: 24px; outline: none; }
        </style>
        <style>${desktopCss}</style>
      </head>
      <body>
        <aside>
          <div class="top-nav">
            <button id="nav-new" type="button"><svg width="16" height="16"></svg><span>新聊天</span></button>
            <button id="nav-bot" type="button"><svg width="16" height="16"></svg><span>Bot</span></button>
          </div>
          <div data-app-action-sidebar-scroll>
            <section id="pinned-sec">
              <div>置顶</div>
              <div role="list">
                <div role="listitem">
                  <div id="pinned-row" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:thread-study-1">
                    <span data-thread-title>置顶会话</span>
                  </div>
                </div>
              </div>
            </section>
            <section id="proj-study">
              <div id="study-bar" style="display:flex;align-items:center;justify-content:space-between;">
                <div id="study-header" data-sidebar-cycle-item role="button" aria-expanded="true">
                  <svg width="14" height="14"></svg><span>Study</span>
                </div>
                <button type="button" aria-label="新建">+</button>
              </div>
              <div role="list">
                <div role="listitem">
                  <div id="study-row" data-app-action-sidebar-thread-row data-app-action-sidebar-thread-id="local:thread-study-1">
                    <span data-thread-title>项目会话</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </aside>
        <main>
          <div data-above-composer-conversation-id="thread-study-1"></div>
          <div data-codex-composer-root>
            <div class="ProseMirror" contenteditable="true" role="textbox"><p><br class="ProseMirror-trailingBreak"></p></div>
            <button type="submit" aria-label="发送">发送</button>
          </div>
        </main>
      </body>
    </html>`);

  await page.addScriptTag({
    content: `
      window.__hostSawEnter = false;
      document.addEventListener("keydown", function (e) {
        if (e.key === "Enter") window.__hostSawEnter = true;
      }, true);
      var __def;
      (function (define) { ${desktopJs}\n })(function (d) { __def = d; });
      var __ctrl = new AbortController();
      __def.activate({
        signal: __ctrl.signal,
        backend: { invoke: function (m, p) { return window.invoke(m, p); } },
        assets: { readDataUrl: function () { return window.readDataUrl(); } },
        storage: { get: async function () { return {}; }, onChange: function () { return function () {}; } },
        dom: {
          mount: function (el, parent, pos) {
            parent[pos || "append"](el);
          }
        },
        sidebar: {
          observeRows: function (cb) {
            cb([
              { element: document.querySelector("#pinned-row"), threadId: "thread-study-1", isLocal: true },
              { element: document.querySelector("#study-row"), threadId: "thread-study-1", isLocal: true }
            ]);
            return function () {};
          }
        },
        navigate: { openThread: async function () {} },
        track: function () {}
      });
    `,
  });

  // Verify top entry sits below 新聊天 & Bot and strictly above 置顶.
  const topBtn = page.locator('[data-althing-owned="top"]');
  await topBtn.waitFor();
  const geometry = await page.evaluate(() => {
    const newRect = document.querySelector("#nav-new")!.getBoundingClientRect();
    const botRect = document.querySelector("#nav-bot")!.getBoundingClientRect();
    const topRect = document
      .querySelector('[data-althing-owned="top"]')!
      .getBoundingClientRect();
    const pinnedRect = document
      .querySelector("#pinned-sec")!
      .getBoundingClientRect();
    const studyBarRect = document
      .querySelector("#study-bar")!
      .getBoundingClientRect();
    const groupRect = document
      .querySelector('#proj-study [data-althing-owned="group"]')!
      .getBoundingClientRect();
    const pinnedGroup = document.querySelector(
      '#pinned-sec [data-althing-owned="group"]',
    );
    return {
      newBottom: newRect.bottom,
      botBottom: botRect.bottom,
      topTop: topRect.top,
      topBottom: topRect.bottom,
      pinnedTop: pinnedRect.top,
      studyBarBottom: studyBarRect.bottom,
      groupTop: groupRect.top,
      hasPinnedGroup: Boolean(pinnedGroup),
    };
  });
  assert.ok(geometry.topTop >= geometry.botBottom - 1);
  assert.ok(geometry.topBottom <= geometry.pinnedTop + 1);
  assert.equal(geometry.hasPinnedGroup, false);
  assert.ok(geometry.groupTop >= geometry.studyBarBottom - 1);

  // Verify ProseMirror /althing floating pill sits cleanly above composer (outside composer root)
  // and real Chromium click + Enter both work and clear ProseMirror cleanly.
  const pm = page.locator(".ProseMirror");
  await pm.click();
  await page.keyboard.type("/althing 实测浏览器议会");
  const pill = page.locator("[data-althing-command]");
  await pill.waitFor();
  const pillInfo = await page.evaluate(() => {
    const composer = document.querySelector("[data-codex-composer-root]")!;
    const p = document.querySelector("[data-althing-command]")!;
    const cRect = composer.getBoundingClientRect();
    const pRect = p.getBoundingClientRect();
    return {
      insideComposer: composer.contains(p),
      aboveComposer: pRect.bottom <= cRect.top + 1,
      visibleInViewport: pRect.top >= 0 && pRect.left >= 0 && pRect.width > 40,
    };
  });
  assert.equal(pillInfo.insideComposer, false);
  assert.equal(pillInfo.aboveComposer, true);
  assert.equal(pillInfo.visibleInViewport, true);

  await page.keyboard.press("Enter");
  const overlay = page.locator('[data-althing-owned="overlay"]');
  await overlay.waitFor();
  await overlay.getByRole("heading", { name: "实测浏览器议会", level: 1 }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).__hostSawEnter), false);
  assert.equal((await pm.innerText()).trim(), "");
  // Clicking native "新聊天" yields the overlay cleanly.
  await page.locator("#nav-new").click();
  await overlay.waitFor({ state: "detached" });
});
