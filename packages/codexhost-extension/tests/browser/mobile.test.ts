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
      await activate({signal,locale:'en',assets:{url:p=>'/'+p},backend:{invoke:window.invoke},
        storage:{get:async()=>({}),onChange:()=>()=>{}},track(){},
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
        await dialog.locator("input[required]").fill(longTitle);
        await check("wizard details");
        await dialog.getByRole("button", { name: "Continue" }).tap();
        await dialog.getByRole("button", { name: /Add expert/ }).tap();
        await dialog.getByRole("button", {name:"Add collaboration experts"}).tap();
        await check("wizard roster");
        await dialog
          .getByRole("button", { name: /Remove expert/ })
          .last()
          .tap();
        await dialog.getByRole("button", { name: "Continue" }).tap();
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
      for (const mode of ["hint", "enter"]) {
        const subject = mode === "enter" ? "通勤研究" : "";
        await editor.fill(mode === "hint" ? "/alt" : "/althing " + subject);
        if (mode === "hint")
          await page.getByRole("button", { name: /\/althing/ }).tap();
        else await editor.press("Enter");
        await workspace.getByRole("dialog").waitFor();
        assert.equal(
          await workspace.getByLabel("Title", { exact: true }).inputValue(),
          subject,
        );
        assert.equal((await editor.innerText()).trim(), "");
        const bounds = await workspace
          .locator(".althing-ext-root")
          .evaluate(measureBounds, 375);
        assert.deepEqual(bounds.problems, []);
        await workspace.getByLabel("Close", { exact: true }).tap();
        await workspace.getByRole("button", { name: "Back to chat" }).tap();
        await workspace.waitFor({ state: "detached" });
      }
    },
  );
}
