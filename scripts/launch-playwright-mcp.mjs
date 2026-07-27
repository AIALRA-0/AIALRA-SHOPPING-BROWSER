#!/usr/bin/env node

import { mkdirSync } from "node:fs"
import { homedir, platform } from "node:os"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

export const PLAYWRIGHT_MCP_VERSION = "0.0.78"

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
  const executable = platform() === "win32" ? "npx.cmd" : "npx"
  const args = [
    "--yes",
    `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`,
    "--browser",
    browser,
    "--user-data-dir",
    profileDirectory,
    "--output-dir",
    outputDirectory,
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
  return {
    executable,
    args,
    profileDirectory,
    outputDirectory,
  }
}

export function launch() {
  const configuration = buildLaunchConfiguration()
  const child = spawn(configuration.executable, configuration.args, {
    cwd: PLUGIN_ROOT,
    env: process.env,
    stdio: "inherit",
    shell: false,
  })

  const forward = (signal) => {
    if (!child.killed) {
      child.kill(signal)
    }
  }
  process.once("SIGINT", () => forward("SIGINT"))
  process.once("SIGTERM", () => forward("SIGTERM"))

  child.once("error", (error) => {
    process.stderr.write(`无法启动 Playwright MCP: ${error.message}\n`)
    process.exitCode = 1
  })
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch()
}
