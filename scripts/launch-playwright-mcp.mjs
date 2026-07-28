#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

export const PLAYWRIGHT_MCP_VERSION = "0.0.78"
export const SINGLETON_START_TIMEOUT_MS = 45_000

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const USER_HOME = homedir()
const ALLOWED_BROWSERS = new Set(["chrome", "msedge"])

function defaultProfileDirectory() {
  if (platform() === "darwin") {
    return resolve(USER_HOME, "Library", "Application Support", "AIALRA Shopping Browser", "Profile")
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA || resolve(USER_HOME, "AppData", "Local")
    return resolve(localAppData, "AIALRA Shopping Browser", "Profile")
  }
  return resolve(USER_HOME, ".local", "share", "aialra-shopping-browser", "profile")
}

function defaultOutputDirectory() {
  if (platform() === "darwin") {
    return resolve(USER_HOME, "Library", "Caches", "AIALRA Shopping Browser", "MCP")
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA || resolve(USER_HOME, "AppData", "Local")
    return resolve(localAppData, "AIALRA Shopping Browser", "MCP")
  }
  return resolve(USER_HOME, ".cache", "aialra-shopping-browser", "mcp")
}

function resolveRuntimeDirectory(rawValue, fallback, label) {
  const chosen = rawValue ? resolve(rawValue) : fallback
  if (!isAbsolute(chosen)) {
    throw new Error(`${label} 必须是绝对路径`)
  }
  if (chosen === resolve("/") || chosen === resolve(USER_HOME)) {
    throw new Error(`${label} 不能是磁盘根目录或整个用户主目录`)
  }
  const relativeToPlugin = relative(PLUGIN_ROOT, chosen)
  if (
    relativeToPlugin === "" ||
    (!relativeToPlugin.startsWith("..") && !isAbsolute(relativeToPlugin))
  ) {
    throw new Error(`${label} 必须位于插件仓库外`)
  }
  mkdirSync(chosen, { recursive: true, mode: 0o700 })
  return chosen
}

function browserExecutableCandidates(browser, environment = process.env) {
  if (environment.AIALRA_SHOPPING_BROWSER_EXECUTABLE) {
    return [resolve(environment.AIALRA_SHOPPING_BROWSER_EXECUTABLE)]
  }
  if (platform() === "darwin") {
    const application = browser === "msedge" ? "Microsoft Edge" : "Google Chrome"
    return [
      `/Applications/${application}.app/Contents/MacOS/${application}`,
      resolve(USER_HOME, "Applications", `${application}.app`, "Contents", "MacOS", application),
    ]
  }
  if (platform() === "win32") {
    const localAppData = environment.LOCALAPPDATA || resolve(USER_HOME, "AppData", "Local")
    const programFiles = environment.PROGRAMFILES || "C:\\Program Files"
    const programFilesX86 = environment["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)"
    const relativeExecutable =
      browser === "msedge"
        ? ["Microsoft", "Edge", "Application", "msedge.exe"]
        : ["Google", "Chrome", "Application", "chrome.exe"]
    return [
      resolve(localAppData, ...relativeExecutable),
      resolve(programFiles, ...relativeExecutable),
      resolve(programFilesX86, ...relativeExecutable),
    ]
  }
  return browser === "msedge"
    ? ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"]
}

export function resolveBrowserExecutable(
  browser,
  environment = process.env,
  fileExists = existsSync,
) {
  const executable = browserExecutableCandidates(browser, environment).find(fileExists)
  if (!executable) {
    throw new Error(
      `没有找到 ${browser === "msedge" ? "Microsoft Edge" : "Google Chrome"}，可以通过 AIALRA_SHOPPING_BROWSER_EXECUTABLE 指定完整路径`,
    )
  }
  return executable
}

export function buildLaunchConfiguration(environment = process.env) {
  const browser = environment.AIALRA_SHOPPING_BROWSER_BROWSER || "chrome"
  if (!ALLOWED_BROWSERS.has(browser)) {
    throw new Error(
      `AIALRA_SHOPPING_BROWSER_BROWSER 只允许 ${[...ALLOWED_BROWSERS].join(" 或 ")}`,
    )
  }
  const profileDirectory = resolveRuntimeDirectory(
    environment.AIALRA_SHOPPING_BROWSER_PROFILE_DIR,
    defaultProfileDirectory(),
    "Chrome 资料目录",
  )
  const outputDirectory = resolveRuntimeDirectory(
    environment.AIALRA_SHOPPING_BROWSER_OUTPUT_DIR,
    defaultOutputDirectory(),
    "MCP 输出目录",
  )
  const singletonDirectory = resolve(outputDirectory, "singleton")
  mkdirSync(singletonDirectory, { recursive: true, mode: 0o700 })
  const executable = platform() === "win32" ? "npx.cmd" : "npx"
  return {
    browser,
    browserExecutable: resolveBrowserExecutable(browser, environment),
    executable,
    keepBrowserAlive:
      environment.AIALRA_SHOPPING_BROWSER_KEEP_BROWSER_ALIVE !== "false",
    outputDirectory,
    profileDirectory,
    singletonDirectory,
    workingDirectory: outputDirectory,
  }
}

export function buildMcpArgs(endpoint, configuration) {
  return [
    "--yes",
    `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`,
    "--cdp-endpoint",
    endpoint,
    "--output-dir",
    configuration.outputDirectory,
    "--output-mode",
    "stdout",
    "--output-max-size",
    "67108864",
    "--codegen",
    "none",
    "--console-level",
    "warning",
    "--timeout-action",
    "10000",
    "--timeout-navigation",
    "90000",
  ]
}

export function buildBrowserArgs(configuration) {
  return [
    `--user-data-dir=${configuration.profileDirectory}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ]
}

function devtoolsPortFile(configuration) {
  return resolve(configuration.profileDirectory, "DevToolsActivePort")
}

export function readDevtoolsEndpoint(configuration) {
  const file = devtoolsPortFile(configuration)
  if (!existsSync(file)) {
    return null
  }
  const [rawPort] = readFileSync(file, "utf8").split(/\r?\n/)
  const port = Number.parseInt(rawPort, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null
  }
  return `http://127.0.0.1:${port}`
}

async function endpointIsHealthy(endpoint) {
  if (!endpoint) {
    return false
  }
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) {
      return false
    }
    const payload = await response.json()
    return typeof payload.webSocketDebuggerUrl === "string"
  } catch {
    return false
  }
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function launchLockDirectory(configuration) {
  return resolve(configuration.singletonDirectory, "launch.lock")
}

function acquireLaunchLock(configuration) {
  const lockDirectory = launchLockDirectory(configuration)
  try {
    mkdirSync(lockDirectory, { mode: 0o700 })
    writeFileSync(
      resolve(lockDirectory, "owner.json"),
      `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    )
    return true
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error
    }
  }
  try {
    const age = Date.now() - statSync(lockDirectory).mtimeMs
    if (age > SINGLETON_START_TIMEOUT_MS * 2) {
      rmSync(lockDirectory, { recursive: true, force: true })
      return acquireLaunchLock(configuration)
    }
  } catch {
    return false
  }
  return false
}

function releaseLaunchLock(configuration) {
  rmSync(launchLockDirectory(configuration), { recursive: true, force: true })
}

async function waitForHealthyEndpoint(configuration, timeoutMs, launchedProcess = null) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const endpoint = readDevtoolsEndpoint(configuration)
    if (await endpointIsHealthy(endpoint)) {
      return endpoint
    }
    if (launchedProcess?.exitCode !== null) {
      throw new Error(
        "独立 Chrome 启动后立即退出，常见原因是旧任务仍占用同一资料目录",
      )
    }
    await sleep(200)
  }
  throw new Error("等待独立 Chrome 的本机 CDP 端点超时")
}

function writeOwnerState(configuration, browserProcess, endpoint) {
  writeFileSync(
    resolve(configuration.singletonDirectory, "browser-owner.json"),
    `${JSON.stringify(
      {
        browser: configuration.browser,
        endpoint,
        launched_at: new Date().toISOString(),
        pid: browserProcess.pid,
        profile_directory: configuration.profileDirectory,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
}

export async function ensureSingletonBrowser(configuration) {
  const existingEndpoint = readDevtoolsEndpoint(configuration)
  if (await endpointIsHealthy(existingEndpoint)) {
    return { endpoint: existingEndpoint, launched: false, browserProcess: null }
  }
  const ownsLock = acquireLaunchLock(configuration)
  if (!ownsLock) {
    const endpoint = await waitForHealthyEndpoint(
      configuration,
      SINGLETON_START_TIMEOUT_MS,
    )
    return { endpoint, launched: false, browserProcess: null }
  }
  try {
    const endpointAfterLock = readDevtoolsEndpoint(configuration)
    if (await endpointIsHealthy(endpointAfterLock)) {
      return {
        endpoint: endpointAfterLock,
        launched: false,
        browserProcess: null,
      }
    }
    const portFile = devtoolsPortFile(configuration)
    if (existsSync(portFile)) {
      unlinkSync(portFile)
    }
    const browserProcess = spawn(
      configuration.browserExecutable,
      buildBrowserArgs(configuration),
      {
        detached: true,
        env: process.env,
        stdio: "ignore",
        shell: false,
      },
    )
    browserProcess.unref()
    const endpoint = await waitForHealthyEndpoint(
      configuration,
      SINGLETON_START_TIMEOUT_MS,
      browserProcess,
    )
    writeOwnerState(configuration, browserProcess, endpoint)
    return { endpoint, launched: true, browserProcess }
  } finally {
    releaseLaunchLock(configuration)
  }
}

export function sanitizeClientMessage(message) {
  if (
    message?.method !== "tools/call" ||
    message?.params?.name !== "browser_snapshot" ||
    typeof message?.params?.arguments?.filename !== "string"
  ) {
    return { message, removedSnapshotFilename: false }
  }
  const { filename: _filename, ...safeArguments } = message.params.arguments
  return {
    message: {
      ...message,
      params: {
        ...message.params,
        arguments: safeArguments,
      },
    },
    removedSnapshotFilename: true,
  }
}

export function sanitizeProtocolLine(line) {
  try {
    const parsed = JSON.parse(line)
    const result = sanitizeClientMessage(parsed)
    return {
      line: JSON.stringify(result.message),
      removedSnapshotFilename: result.removedSnapshotFilename,
    }
  } catch {
    return { line, removedSnapshotFilename: false }
  }
}

export async function launch() {
  const configuration = buildLaunchConfiguration()
  const singleton = await ensureSingletonBrowser(configuration)
  const args = buildMcpArgs(singleton.endpoint, configuration)
  const child = spawn(configuration.executable, args, {
    cwd: configuration.workingDirectory,
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
    shell: false,
  })

  child.stdout.pipe(process.stdout)
  const clientLines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })
  clientLines.on("line", (line) => {
    const sanitized = sanitizeProtocolLine(line)
    if (sanitized.removedSnapshotFilename) {
      process.stderr.write("已忽略 browser_snapshot filename，页面快照只通过标准输出返回\n")
    }
    child.stdin.write(`${sanitized.line}\n`)
  })
  clientLines.once("close", () => {
    child.stdin.end()
  })

  const closeOwnedBrowser = () => {
    if (
      singleton.launched &&
      !configuration.keepBrowserAlive &&
      singleton.browserProcess?.pid
    ) {
      try {
        process.kill(singleton.browserProcess.pid, "SIGTERM")
      } catch {
        return
      }
    }
  }
  const forward = (signal) => {
    if (!child.killed) {
      child.kill(signal)
    }
    closeOwnedBrowser()
  }
  process.once("SIGINT", () => forward("SIGINT"))
  process.once("SIGTERM", () => forward("SIGTERM"))

  child.once("error", (error) => {
    process.stderr.write(`无法启动 Playwright MCP: ${error.message}\n`)
    closeOwnedBrowser()
    process.exitCode = 1
  })
  child.once("exit", (code, signal) => {
    clientLines.close()
    closeOwnedBrowser()
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch().catch((error) => {
    process.stderr.write(`无法启动共享购物浏览器: ${error.message}\n`)
    process.exitCode = 1
  })
}
