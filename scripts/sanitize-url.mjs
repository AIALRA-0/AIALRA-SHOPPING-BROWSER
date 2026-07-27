#!/usr/bin/env node

import { pathToFileURL } from "node:url"
import { sanitizeUrl } from "./observation-lib.mjs"

function parseUrl(argv) {
  const index = argv.indexOf("--url")
  if (index === -1 || !argv[index + 1]) {
    throw new Error("用法 node scripts/sanitize-url.mjs --url <url>")
  }
  return argv[index + 1]
}

function main() {
  try {
    const sanitized = sanitizeUrl(parseUrl(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify({ sanitized_url: sanitized }, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
