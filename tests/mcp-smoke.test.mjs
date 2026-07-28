import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { access, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

function createRpcClient(child) {
  let nextId = 1
  let buffer = ""
  const pending = new Map()

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n")
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line.startsWith("{")) {
        continue
      }
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) {
          reject(new Error(JSON.stringify(message.error)))
        } else {
          resolve(message.result)
        }
      }
    }
  })

  function request(method, params = {}) {
    const id = nextId++
    const payload = { jsonrpc: "2.0", id, method, params }
    child.stdin.write(`${JSON.stringify(payload)}\n`)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP 请求超时 ${method}`))
      }, 120_000)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      })
    })
  }

  function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
  }

  return { request, notify }
}

test("MCP 能启动 Chrome 并读取本地商品页面", { timeout: 180_000 }, async (t) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "aialra-shopping-browser-mcp-"))
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(`<!doctype html>
      <html lang="zh-CN">
        <head><title>本地测试商店</title></head>
        <body>
          <main>
            <h1>本地测试商店</h1>
            <article>
              <a href="/item/fixture-001">本地测试商品</a>
              <span aria-label="价格">¥100</span>
            </article>
          </main>
        </body>
      </html>`)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const fixtureUrl = `http://127.0.0.1:${address.port}/search?q=test`

  const child = spawn("node", ["scripts/launch-playwright-mcp.mjs"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      AIALRA_SHOPPING_BROWSER_PROFILE_DIR: join(temporaryRoot, "profile"),
      AIALRA_SHOPPING_BROWSER_OUTPUT_DIR: join(temporaryRoot, "output"),
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })

  t.after(async () => {
    child.kill("SIGTERM")
    server.close()
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  const rpc = createRpcClient(child)
  await rpc.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: {
      name: "aialra-shopping-browser-smoke",
      version: "0.1.0",
    },
  })
  rpc.notify("notifications/initialized")

  const listed = await rpc.request("tools/list")
  const names = new Set(listed.tools.map((tool) => tool.name))
  assert.ok(names.has("browser_navigate"))
  assert.ok(names.has("browser_snapshot"))
  assert.ok(names.has("browser_close"))

  await rpc.request("tools/call", {
    name: "browser_navigate",
    arguments: { url: fixtureUrl },
  })
  const snapshot = await rpc.request("tools/call", {
    name: "browser_snapshot",
    arguments: { filename: "raw-page.snapshot.md" },
  })
  const text = snapshot.content
    .filter((entry) => entry.type === "text")
    .map((entry) => entry.text)
    .join("\n")
  assert.match(text, /本地测试商品/)
  assert.match(text, /¥100/)
  await assert.rejects(
    access(join(temporaryRoot, "output", "raw-page.snapshot.md")),
  )

  await rpc.request("tools/call", {
    name: "browser_close",
    arguments: {},
  })
  assert.equal(stderr.includes("Error"), false, stderr)
})
