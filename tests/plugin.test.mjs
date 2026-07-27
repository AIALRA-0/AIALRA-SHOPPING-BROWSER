import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)

async function json(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8"))
}

test("插件清单声明 MCP 和 Skill", async () => {
  const manifest = await json(".codex-plugin/plugin.json")
  assert.equal(manifest.name, "aialra-shopping-browser")
  assert.equal(manifest.mcpServers, "./.mcp.json")
  assert.equal(manifest.skills, "./skills/")
  assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read"])
})

test("MCP 配置只传固定启动器 argv", async () => {
  const manifest = await json(".mcp.json")
  const server = manifest.mcpServers["aialra-shopping-browser"]
  assert.equal(server.command, "node")
  assert.deepEqual(server.args, ["./scripts/launch-playwright-mcp.mjs"])
  assert.equal(server.cwd, ".")
  assert.equal(server.shell, undefined)
})

test("版本文件保持一致", async () => {
  const plugin = await json(".codex-plugin/plugin.json")
  const packageJson = await json("package.json")
  const version = (await readFile(new URL("VERSION", root), "utf8")).trim()
  assert.equal(plugin.version, version)
  assert.equal(packageJson.version, version)
})

test("Skill 包含人工验证和策略停止规则", async () => {
  const skill = await readFile(
    new URL("skills/shopping-browser-research/SKILL.md", root),
    "utf8",
  )
  assert.match(skill, /用户必须直接在可见 Chrome 窗口里/)
  assert.match(skill, /policy-blocked/)
  assert.match(skill, /不能自动重试/)
  assert.match(skill, /不读取 Cookie/)
})
