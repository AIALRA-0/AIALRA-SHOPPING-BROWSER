import test from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { readFile } from "node:fs/promises"
import {
  buildBrowserArgs,
  buildLaunchConfiguration,
  buildMcpArgs,
  cleanupStaleSessionDirectories,
  createSessionOutputDirectory,
  PLAYWRIGHT_MCP_VERSION,
  removeSessionOutputDirectory,
  resolveBrowserExecutable,
  sanitizeClientMessage,
  sanitizeProtocolLine,
} from "../scripts/launch-playwright-mcp.mjs"
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

test("启动器固定依赖版本并让 MCP 连接共享 CDP 端点", () => {
  const profileDirectory = `/tmp/aialra-shopping-browser-unit-${process.pid}/profile`
  const outputDirectory = `/tmp/aialra-shopping-browser-unit-${process.pid}/output`
  const configuration = buildLaunchConfiguration({
    AIALRA_SHOPPING_BROWSER_EXECUTABLE: process.execPath,
    AIALRA_SHOPPING_BROWSER_PROFILE_DIR: profileDirectory,
    AIALRA_SHOPPING_BROWSER_OUTPUT_DIR: outputDirectory,
    AIALRA_SHOPPING_BROWSER_BROWSER: "chrome",
  })
  const sessionOutputDirectory = `${outputDirectory}/session-test`
  const args = buildMcpArgs(
    "http://127.0.0.1:12345",
    configuration,
    sessionOutputDirectory,
  )
  assert.equal(PLAYWRIGHT_MCP_VERSION, "0.0.78")
  assert.ok(args.includes(`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`))
  assert.ok(args.includes("--cdp-endpoint"))
  assert.equal(
    args[args.indexOf("--cdp-endpoint") + 1],
    "http://127.0.0.1:12345",
  )
  assert.equal(args.includes("--user-data-dir"), false)
  assert.ok(args.includes("--output-max-size"))
  assert.equal(
    args[args.indexOf("--output-dir") + 1],
    sessionOutputDirectory,
  )
  assert.ok(args.includes("--output-mode"))
  assert.equal(
    args[args.indexOf("--output-mode") + 1],
    "stdout",
  )
  const browserArgs = buildBrowserArgs(configuration)
  assert.ok(browserArgs.includes(`--user-data-dir=${profileDirectory}`))
  assert.ok(browserArgs.includes("--remote-debugging-address=127.0.0.1"))
  assert.ok(browserArgs.includes("--remote-debugging-port=0"))
  assert.equal(configuration.workingDirectory, outputDirectory)
})

test("客户端临时输出目录使用私有权限并能完整清理", (t) => {
  const temporaryRoot = `/tmp/aialra-shopping-browser-session-${process.pid}`
  const profileDirectory = `/tmp/aialra-shopping-browser-session-${process.pid}/profile`
  const outputDirectory = `/tmp/aialra-shopping-browser-session-${process.pid}/output`
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const configuration = buildLaunchConfiguration({
    AIALRA_SHOPPING_BROWSER_EXECUTABLE: process.execPath,
    AIALRA_SHOPPING_BROWSER_PROFILE_DIR: profileDirectory,
    AIALRA_SHOPPING_BROWSER_OUTPUT_DIR: outputDirectory,
  })
  const sessionDirectory = createSessionOutputDirectory(configuration)
  assert.ok(sessionDirectory.startsWith(`${outputDirectory}/session-`))
  removeSessionOutputDirectory(configuration, sessionDirectory)
  assert.throws(
    () =>
      removeSessionOutputDirectory(
        configuration,
        `/tmp/aialra-shopping-browser-session-${process.pid}`,
      ),
    /不在允许范围内/,
  )
})

test("后续启动只清理已经退出客户端留下的目录", (t) => {
  const temporaryRoot = `/tmp/aialra-shopping-browser-stale-${process.pid}`
  const configuration = buildLaunchConfiguration({
    AIALRA_SHOPPING_BROWSER_EXECUTABLE: process.execPath,
    AIALRA_SHOPPING_BROWSER_PROFILE_DIR: `${temporaryRoot}/profile`,
    AIALRA_SHOPPING_BROWSER_OUTPUT_DIR: `${temporaryRoot}/output`,
  })
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const staleDirectory = `${configuration.outputDirectory}/session-stale-test`
  const liveDirectory = `${configuration.outputDirectory}/session-live-test`
  mkdirSync(staleDirectory, { mode: 0o700 })
  mkdirSync(liveDirectory, { mode: 0o700 })
  writeFileSync(
    `${staleDirectory}/owner.json`,
    `${JSON.stringify({ pid: 2_147_483_647 })}\n`,
    { mode: 0o600 },
  )
  writeFileSync(
    `${liveDirectory}/owner.json`,
    `${JSON.stringify({ pid: process.pid })}\n`,
    { mode: 0o600 },
  )
  cleanupStaleSessionDirectories(configuration)
  assert.equal(existsSync(staleDirectory), false)
  assert.equal(existsSync(liveDirectory), true)
  removeSessionOutputDirectory(configuration, liveDirectory)
})

test("浏览器程序可以通过明确的绝对路径配置", () => {
  const executable = resolveBrowserExecutable(
    "chrome",
    { AIALRA_SHOPPING_BROWSER_EXECUTABLE: "/opt/aialra/chrome" },
    (candidate) => candidate === "/opt/aialra/chrome",
  )
  assert.equal(executable, "/opt/aialra/chrome")
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

test("浏览器快照文件名在进入 MCP 前被移除", () => {
  const request = {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "browser_snapshot",
      arguments: {
        depth: 10,
        filename: "raw-page.snapshot.md",
      },
    },
  }
  const sanitized = sanitizeClientMessage(request)
  assert.equal(sanitized.removedSnapshotFilename, true)
  assert.deepEqual(sanitized.message.params.arguments, { depth: 10 })
  assert.equal(request.params.arguments.filename, "raw-page.snapshot.md")

  const line = sanitizeProtocolLine(JSON.stringify(request))
  assert.equal(line.removedSnapshotFilename, true)
  assert.equal(JSON.parse(line.line).params.arguments.filename, undefined)
})

test("非快照请求保持原样", () => {
  const request = {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "browser_navigate",
      arguments: { url: "https://example.com" },
    },
  }
  const sanitized = sanitizeClientMessage(request)
  assert.equal(sanitized.removedSnapshotFilename, false)
  assert.equal(sanitized.message, request)
})
