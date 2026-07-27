import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { buildLaunchConfiguration, PLAYWRIGHT_MCP_VERSION } from "../scripts/launch-playwright-mcp.mjs"
import { sanitizeUrl, validateObservation } from "../scripts/observation-lib.mjs"

const fixtureUrl = new URL("./fixtures/observation.valid.json", import.meta.url)
const invalidFixtureUrl = new URL("./fixtures/observation.invalid.json", import.meta.url)

test("有效观察通过校验", async () => {
  const payload = JSON.parse(await readFile(fixtureUrl, "utf8"))
  assert.deepEqual(validateObservation(payload), [])
})

test("危险字段 链接 时间和账户写入会被拒绝", async () => {
  const payload = JSON.parse(await readFile(invalidFixtureUrl, "utf8"))
  const errors = validateObservation(payload)
  assert.ok(errors.length >= 6)
  assert.ok(errors.some((error) => error.includes("敏感字段")))
  assert.ok(errors.some((error) => error.includes("带时区")))
  assert.ok(errors.some((error) => error.includes("account_write_performed")))
})

test("URL 清理保留商品编号并移除追踪和令牌", () => {
  const sanitized = sanitizeUrl(
    "https://shop.invalid/item?id=123&utm_source=test&xsec_token=secret#detail",
  )
  assert.equal(sanitized, "https://shop.invalid/item?id=123")
})

test("启动器固定依赖版本并使用 argv 和 shell false", () => {
  const profileDirectory = `/tmp/aialra-shopping-browser-unit-${process.pid}/profile`
  const outputDirectory = `/tmp/aialra-shopping-browser-unit-${process.pid}/output`
  const configuration = buildLaunchConfiguration({
    AIALRA_SHOPPING_BROWSER_PROFILE_DIR: profileDirectory,
    AIALRA_SHOPPING_BROWSER_OUTPUT_DIR: outputDirectory,
    AIALRA_SHOPPING_BROWSER_BROWSER: "chrome",
  })
  assert.equal(PLAYWRIGHT_MCP_VERSION, "0.0.78")
  assert.ok(configuration.args.includes(`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`))
  assert.ok(configuration.args.includes("--user-data-dir"))
  assert.ok(configuration.args.includes("--output-max-size"))
})

test("启动器拒绝把资料写入插件仓库", () => {
  assert.throws(
    () =>
      buildLaunchConfiguration({
        AIALRA_SHOPPING_BROWSER_PROFILE_DIR: new URL("../runtime", import.meta.url).pathname,
        AIALRA_SHOPPING_BROWSER_OUTPUT_DIR: `/tmp/aialra-shopping-browser-unit-${process.pid}/output`,
      }),
    /插件仓库外/,
  )
})
