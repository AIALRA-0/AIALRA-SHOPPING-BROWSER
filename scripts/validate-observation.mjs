#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { validateObservation } from "./observation-lib.mjs"

function parseInputPath(argv) {
  const index = argv.indexOf("--input")
  if (index === -1 || !argv[index + 1]) {
    throw new Error("用法 node scripts/validate-observation.mjs --input <observation.json>")
  }
  return argv[index + 1]
}

export async function validateObservationFile(inputPath) {
  const payload = JSON.parse(await readFile(inputPath, "utf8"))
  const errors = validateObservation(payload)
  return {
    valid: errors.length === 0,
    errors,
  }
}

async function main() {
  try {
    const inputPath = parseInputPath(process.argv.slice(2))
    const result = await validateObservationFile(inputPath)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.valid) {
      process.exitCode = 1
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
