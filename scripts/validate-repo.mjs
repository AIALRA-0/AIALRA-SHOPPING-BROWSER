#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const REQUIRED_FILES = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "skills/shopping-browser-research/SKILL.md",
  "skills/shopping-browser-research/agents/openai.yaml",
  "schemas/observation.schema.json",
  "scripts/launch-playwright-mcp.mjs",
  "scripts/validate-observation.mjs",
  "README.md",
  "SECURITY.md",
  "LICENSE",
  "VERSION",
]

function fail(message) {
  throw new Error(message)
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function walk(directory) {
  const files = []
  for (const entry of readdirSync(directory)) {
    if ([".git", "node_modules", "coverage", "runtime", "output"].includes(entry)) {
      continue
    }
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      files.push(...walk(path))
    } else {
      files.push(path)
    }
  }
  return files
}

function validateRequiredFiles() {
  for (const relativePath of REQUIRED_FILES) {
    try {
      statSync(join(ROOT, relativePath))
    } catch {
      fail(`缺少文件 ${relativePath}`)
    }
  }
}

function validateManifests() {
  const plugin = loadJson(join(ROOT, ".codex-plugin", "plugin.json"))
  const mcp = loadJson(join(ROOT, ".mcp.json"))
  const packageJson = loadJson(join(ROOT, "package.json"))
  const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim()
  if (plugin.name !== "aialra-shopping-browser") {
    fail("插件名称不正确")
  }
  if (plugin.version !== version || packageJson.version !== version) {
    fail("VERSION 插件清单和 package.json 版本不一致")
  }
  if (plugin.mcpServers !== "./.mcp.json" || plugin.skills !== "./skills/") {
    fail("插件资源路径不正确")
  }
  const server = mcp.mcpServers?.["aialra-shopping-browser"]
  if (!server || server.command !== "node") {
    fail("MCP 服务缺失或命令不正确")
  }
  if (
    !Array.isArray(server.args) ||
    server.args.length !== 1 ||
    server.args[0] !== "./scripts/launch-playwright-mcp.mjs"
  ) {
    fail("MCP 启动参数必须是固定 argv 数组")
  }
  if ("shell" in server) {
    fail("MCP 配置不能启用 shell")
  }
}

function validateDocs() {
  for (const file of walk(ROOT).filter((path) => path.endsWith(".md"))) {
    const content = readFileSync(file, "utf8")
    if (content.includes("。")) {
      fail(`${relative(ROOT, file)} 含中文句号`)
    }
    if (content.split(/\r?\n/).some((line) => /；\s*$/.test(line))) {
      fail(`${relative(ROOT, file)} 有段落以中文分号结尾`)
    }
  }
}

function validateSecretPatterns() {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[opsu]_[A-Za-z0-9]{30,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*\b/,
  ]
  for (const file of walk(ROOT)) {
    if (statSync(file).size > 2_000_000) {
      continue
    }
    const content = readFileSync(file, "utf8")
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        fail(`${relative(ROOT, file)} 命中敏感信息模式`)
      }
    }
  }
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  })
}

function main() {
  validateRequiredFiles()
  validateManifests()
  validateDocs()
  validateSecretPatterns()
  run("node", ["scripts/validate-observation.mjs", "--input", "tests/fixtures/observation.valid.json"])
  run("node", ["--test", "tests/unit.test.mjs", "tests/plugin.test.mjs"])
  process.stdout.write("仓库验证通过\n")
}

try {
  main()
} catch (error) {
  process.stderr.write(`仓库验证失败: ${error.message}\n`)
  process.exitCode = 1
}
