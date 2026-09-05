const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const out = path.resolve(
  __dirname,
  "../../docs/trade-intent-study/screenshots",
);
fs.mkdirSync(out, { recursive: true });
const origin = "http://127.0.0.1:8912";
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage(),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", (r) => {
    if (!r.request().url().startsWith(origin)) {
      external.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  async function visit(route) {
    await page.goto(`${origin}/${route}`);
    await page.locator("main, .reviewpage").first().waitFor();
    await page.waitForTimeout(150);
  }
  async function shot(name) {
    await page.locator(".artbox img").evaluateAll(async (images) => {
      await Promise.all(images.map(async (image) => {
        image.loading = "eager";
        await image.decode();
      }));
    });
    await page.waitForTimeout(180);
    await page.screenshot({
      path: path.join(out, name + ".png"),
      fullPage: false,
    });
  }
  async function geometry() {
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "page overflow",
    );
    const failed = await page
      .locator(".artbox img")
      .evaluateAll((imgs) =>
        imgs.filter((i) => i.complete && !i.naturalWidth).map((i) => i.src),
      );
    assert.deepEqual(failed, []);
  }
  await visit("#list");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".tile").first().waitFor();
  const screens = [
    "list",
    "people",
    "match/mira",
    "public",
    "session",
    "large",
    "special",
    "empty",
    "concepts",
  ];
  for (const width of [320, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const route of screens) {
      await visit("#" + route);
      console.log("Layout", width, route);
      await geometry();
      if (width === 390 || width === 1440)
        await shot(route.replace("/", "-") + "-" + width);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("#list");
  await page.locator('[data-id="base-131-shiny-want"]').first().click();
  assert.equal(await page.locator("#edit-variant").inputValue(), "base-131");
  await page.keyboard.press("Escape");
  await page.locator('[data-id="gengar-gmax-want"]').first().click();
  assert.equal(await page.locator("#edit-max").inputValue(), "Gigantamax");
  await shot("max-detail-390");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Add Pokemon", exact: true })
    .last()
    .click();
  await page
    .getByRole("searchbox", { name: "Search Pokemon catalog" })
    .fill("Snom");
  await shot("add-390");
  await page.locator("[data-action=pick]").first().click();
  await page.locator("#edit-offer").check();
  await shot("edit-both-390");
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("pogo-intent-study-v1") || "null"),
  );
  await page.getByRole("button", { name: "Save intent", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("pogo-intent-study-v1")),
  );
  assert(saved.entries.some((p) => p.name === "Snom" && p.want && p.offer));
  assert.equal(saved.entries.filter(p => p.name === "Snom").length, 1);
  await page.getByRole("searchbox", { name: "Search my list" }).fill("Snom");
  assert((await page.locator(".tile").count()) >= 2);
  await page.getByRole("searchbox", { name: "Search my list" }).fill("");
  await page.getByRole("button", { name: "Show compact rows" }).click();
  assert((await page.locator(".entryrow").count()) > 20);
  await shot("combined-rows-390");
  await page.getByRole("button", { name: "Show sprite grid" }).click();
  await page.getByRole("button", { name: "Select entries" }).click();
  await page.locator(".tile").first().click();
  await page.locator("[data-action=share-selection]").click();
  await page.locator("[data-action=share-output][data-value=image]").click();
  await page.waitForFunction(
    () => document.querySelector("#export-canvas")?.dataset.ready === "true",
  );
  const nonblank = await page.locator("canvas").evaluate((c) => {
    const ctx = c.getContext("2d");
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) dark++;
    return dark > 500;
  });
  assert(nonblank);
  await shot("share-image-390");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download image" }).click();
  await (await downloadPromise).saveAs(path.join(out, "selected-export.png"));
  await page.locator("[data-action=share-output][data-value=text]").click();
  await page.getByRole("button", { name: "Copy text" }).click();
  assert(
    (await page.evaluate(() => navigator.clipboard.readText())).includes(
      "Looking For",
    ),
  );
  await page.keyboard.press("Escape");
  await visit("#public");
  await page.getByRole("button", { name: "Check what I can offer" }).click();
  await page.locator("[data-anon]").first().check();
  await page.getByRole("button", { name: "Show my candidates" }).click();
  assert(
    await page
      .getByText("You selected 1 possible offers.", { exact: false })
      .isVisible(),
  );
  await page.getByRole("button", { name: "Copy my candidates" }).click();
  await page.getByRole("button", { name: "Copy search", exact: true }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "!traded&133",
  );
  await shot("contextual-search-390");
  await page.keyboard.press("Escape");
  await visit("#match/mira");
  await page.getByRole("button", { name: "Prepare a trade" }).click();
  await page.locator("#meeting").fill("Synthetic weekend meetup");
  await page.locator("[data-done]").first().check();
  assert.equal(await page.locator("#meeting").inputValue(), "Synthetic weekend meetup");
  await page.getByRole("button", {name:"Copy coordination message"}).click();
  const message = await page.locator("#message-text").inputValue();
  assert(message.includes("Chicago 2026 · BG"));
  assert(message.includes("Synthetic weekend meetup"));
  await page.keyboard.press("Escape");
  await shot("session-checked-390");
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("pogo-intent-study-v1")),
  );
  assert.deepEqual(
    after.entries,
    saved.entries,
    "checklist changed standing intent",
  );
  await visit("#large");
  await page.getByRole("button", { name: "Next page" }).click();
  assert(await page.getByText("Page 2 of 5").isVisible());
  await visit("?concept=b#people");
  await shot("concept-b-390");
  await visit("?concept=c#session");
  await shot("concept-c-390");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  fs.writeFileSync(
    path.join(out, "verification.json"),
    JSON.stringify(
      {
        viewports: [320, 390, 430, 1440],
        states: screens,
        passed: [
          "36 route/viewport checks",
          "add/edit both intents",
          "duplicate declarations merge sides",
          "base shiny editor retains base variant",
          "Max detail control retains qualification",
          "search filter",
          "row/grid switch",
          "selection scope",
          "image preview pixel check/download",
          "text copy",
          "anonymous local subset",
          "contextual query copy",
          "session does not mutate list",
          "coordination retains exact qualifiers and edited context",
          "300-entry paging",
          "three IA routes",
        ],
        consoleErrors: errors,
        externalRequests: external,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  console.log("Prototype verification passed. Screenshots and evidence saved.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
