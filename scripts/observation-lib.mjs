import { URL } from "node:url"

export const OBSERVATION_SCHEMA_VERSION = "1.0"

const ACTIONS = new Set(["preflight", "search", "detail"])
const STATUSES = new Set([
  "results-visible",
  "no-results-visible",
  "completed",
  "login-required",
  "challenge-required",
  "rate-limited",
  "layout-changed",
  "policy-blocked",
  "fatal",
])
const STOP_SIGNALS = new Set([
  "none",
  "user-required",
  "challenge-required",
  "rate-limited",
  "layout-changed",
  "policy-blocked",
  "fatal",
])
const EVIDENCE_SOURCES = new Set([
  "accessibility-snapshot",
  "visible-dom",
  "screenshot",
])
const SECRET_KEYS = new Set([
  "cookie",
  "cookies",
  "password",
  "passwd",
  "authorization",
  "access_token",
  "refresh_token",
  "id_token",
  "storage_state",
  "local_storage",
  "session_storage",
  "browser_profile",
  "otp",
  "verification_code",
])
const SECRET_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "auth",
  "authorization",
  "code",
  "sid",
  "session",
  "cookie",
  "xsec_token",
])
const TRACKING_QUERY_KEYS = new Set([
  "spm",
  "scm",
  "xsec_source",
  "share_red_id",
  "sharer_shareid",
  "traceid",
  "ref",
  "ref_",
  "source",
  "from",
  "aff",
  "aff_id",
  "campid",
  "_trkparms",
])

function normalizedKey(value) {
  return String(value).trim().toLowerCase().replaceAll("-", "_")
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function checkAllowedKeys(value, allowed, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} 必须是对象`)
    return false
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${path}.${key} 是未声明字段`)
    }
  }
  return true
}

function requireKeys(value, required, path, errors) {
  if (!isPlainObject(value)) {
    return
  }
  for (const key of required) {
    if (!(key in value)) {
      errors.push(`${path}.${key} 缺失`)
    }
  }
}

function isHttpUrl(raw) {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function hostMatches(host, rule) {
  const normalizedHost = host.toLowerCase()
  const normalizedRule = rule.toLowerCase().replace(/^\*\./, "")
  return normalizedHost === normalizedRule || normalizedHost.endsWith(`.${normalizedRule}`)
}

function checkUrl(raw, allowedHosts, path, errors, { allowNull = false } = {}) {
  if (raw === null && allowNull) {
    return
  }
  if (typeof raw !== "string" || !isHttpUrl(raw)) {
    errors.push(`${path} 必须是 http 或 https URL`)
    return
  }
  const sanitized = sanitizeUrl(raw)
  if (sanitized !== raw) {
    errors.push(`${path} 仍含临时令牌 跟踪参数或片段，应改为 ${sanitized}`)
  }
  const host = new URL(raw).hostname
  if (!allowedHosts.some((rule) => hostMatches(host, rule))) {
    errors.push(`${path} 的主机 ${host} 不在 allowed_hosts 中`)
  }
}

function checkNoSecrets(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => checkNoSecrets(entry, `${path}[${index}]`, errors))
    return
  }
  if (!isPlainObject(value)) {
    if (typeof value === "string" && /^Bearer\s+[A-Za-z0-9._~+/-]{12,}=*$/i.test(value)) {
      errors.push(`${path} 不能包含授权令牌`)
    }
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEYS.has(normalizedKey(key))) {
      errors.push(`${path}.${key} 是禁止的敏感字段`)
    }
    checkNoSecrets(entry, `${path}.${key}`, errors)
  }
}

function checkTimestamp(value, path, errors) {
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    errors.push(`${path} 必须是带时区的 ISO 8601 时间`)
  }
}

function checkPrimitiveFields(fields, path, errors) {
  if (!isPlainObject(fields)) {
    errors.push(`${path} 必须是对象`)
    return
  }
  if (Object.keys(fields).length > 100) {
    errors.push(`${path} 最多包含 100 个字段`)
  }
  for (const [key, value] of Object.entries(fields)) {
    if (
      value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    ) {
      errors.push(`${path}.${key} 只能是字符串 数字 布尔值或 null`)
    }
  }
}

export function sanitizeUrl(raw) {
  if (typeof raw !== "string" || !isHttpUrl(raw)) {
    throw new TypeError("URL 必须是 http 或 https 字符串")
  }
  const parsed = new URL(raw)
  const keys = [...parsed.searchParams.keys()]
  for (const key of keys) {
    const normalized = normalizedKey(key)
    if (
      normalized.startsWith("utm_") ||
      SECRET_QUERY_KEYS.has(normalized) ||
      TRACKING_QUERY_KEYS.has(normalized)
    ) {
      parsed.searchParams.delete(key)
    }
  }
  parsed.hash = ""
  parsed.searchParams.sort()
  return parsed.toString()
}

export function validateObservation(document) {
  const errors = []
  if (!isPlainObject(document)) {
    return ["根节点必须是对象"]
  }

  checkNoSecrets(document, "$", errors)
  checkAllowedKeys(
    document,
    new Set(["identity", "access", "collection", "evidence", "safety"]),
    "$",
    errors,
  )
  requireKeys(
    document,
    ["identity", "access", "collection", "evidence", "safety"],
    "$",
    errors,
  )

  const identity = document.identity
  if (
    checkAllowedKeys(
      identity,
      new Set(["schema_version", "run_id", "platform", "action"]),
      "$.identity",
      errors,
    )
  ) {
    requireKeys(identity, ["schema_version", "run_id", "platform", "action"], "$.identity", errors)
    if (identity.schema_version !== OBSERVATION_SCHEMA_VERSION) {
      errors.push(`$.identity.schema_version 必须是 ${OBSERVATION_SCHEMA_VERSION}`)
    }
    for (const key of ["run_id", "platform"]) {
      if (typeof identity[key] !== "string" || identity[key].length === 0) {
        errors.push(`$.identity.${key} 必须是非空字符串`)
      }
    }
    if (!ACTIONS.has(identity.action)) {
      errors.push("$.identity.action 不是允许值")
    }
  }

  const access = document.access
  let allowedHosts = []
  if (
    checkAllowedKeys(
      access,
      new Set(["status", "source_backend", "page_url", "page_title", "allowed_hosts"]),
      "$.access",
      errors,
    )
  ) {
    requireKeys(
      access,
      ["status", "source_backend", "page_url", "page_title", "allowed_hosts"],
      "$.access",
      errors,
    )
    if (!STATUSES.has(access.status)) {
      errors.push("$.access.status 不是允许值")
    }
    if (access.source_backend !== "aialra-shopping-browser") {
      errors.push("$.access.source_backend 必须是 aialra-shopping-browser")
    }
    if (
      !Array.isArray(access.allowed_hosts) ||
      access.allowed_hosts.length === 0 ||
      access.allowed_hosts.some((host) => typeof host !== "string" || host.length === 0)
    ) {
      errors.push("$.access.allowed_hosts 必须是非空主机数组")
    } else {
      allowedHosts = [...new Set(access.allowed_hosts)]
      if (allowedHosts.length !== access.allowed_hosts.length) {
        errors.push("$.access.allowed_hosts 不能重复")
      }
    }
    checkUrl(access.page_url, allowedHosts, "$.access.page_url", errors, { allowNull: true })
    if (access.page_title !== null && typeof access.page_title !== "string") {
      errors.push("$.access.page_title 必须是字符串或 null")
    }
  }

  const collection = document.collection
  if (
    checkAllowedKeys(
      collection,
      new Set(["query", "round_id", "sort_mode", "observed_at", "visible_item_count"]),
      "$.collection",
      errors,
    )
  ) {
    requireKeys(
      collection,
      ["query", "round_id", "sort_mode", "observed_at", "visible_item_count"],
      "$.collection",
      errors,
    )
    for (const key of ["query", "round_id", "sort_mode"]) {
      if (collection[key] !== null && typeof collection[key] !== "string") {
        errors.push(`$.collection.${key} 必须是字符串或 null`)
      }
    }
    checkTimestamp(collection.observed_at, "$.collection.observed_at", errors)
    if (
      !Number.isInteger(collection.visible_item_count) ||
      collection.visible_item_count < 0
    ) {
      errors.push("$.collection.visible_item_count 必须是非负整数")
    }
  }

  const evidence = document.evidence
  if (
    checkAllowedKeys(evidence, new Set(["items", "warnings"]), "$.evidence", errors)
  ) {
    requireKeys(evidence, ["items", "warnings"], "$.evidence", errors)
    if (!Array.isArray(evidence.items)) {
      errors.push("$.evidence.items 必须是数组")
    } else {
      const stableIds = new Set()
      evidence.items.forEach((item, index) => {
        const itemPath = `$.evidence.items[${index}]`
        if (
          !checkAllowedKeys(
            item,
            new Set([
              "stable_id",
              "title",
              "canonical_url",
              "image_urls",
              "fields",
              "observations",
            ]),
            itemPath,
            errors,
          )
        ) {
          return
        }
        requireKeys(
          item,
          ["stable_id", "title", "canonical_url", "image_urls", "fields", "observations"],
          itemPath,
          errors,
        )
        if (typeof item.stable_id !== "string" || item.stable_id.length === 0) {
          errors.push(`${itemPath}.stable_id 必须是非空字符串`)
        } else if (stableIds.has(item.stable_id)) {
          errors.push(`${itemPath}.stable_id 在同一观察中重复`)
        } else {
          stableIds.add(item.stable_id)
        }
        if (typeof item.title !== "string" || item.title.length === 0) {
          errors.push(`${itemPath}.title 必须是非空字符串`)
        }
        checkUrl(item.canonical_url, allowedHosts, `${itemPath}.canonical_url`, errors)
        if (!Array.isArray(item.image_urls)) {
          errors.push(`${itemPath}.image_urls 必须是数组`)
        } else {
          item.image_urls.forEach((url, imageIndex) => {
            if (typeof url !== "string" || !isHttpUrl(url)) {
              errors.push(`${itemPath}.image_urls[${imageIndex}] 必须是 http 或 https URL`)
            }
          })
        }
        checkPrimitiveFields(item.fields, `${itemPath}.fields`, errors)
        if (!Array.isArray(item.observations) || item.observations.length === 0) {
          errors.push(`${itemPath}.observations 必须是非空数组`)
        } else {
          item.observations.forEach((observation, observationIndex) => {
            const observationPath = `${itemPath}.observations[${observationIndex}]`
            if (
              !checkAllowedKeys(
                observation,
                new Set(["source", "locator", "text_excerpt"]),
                observationPath,
                errors,
              )
            ) {
              return
            }
            requireKeys(
              observation,
              ["source", "locator", "text_excerpt"],
              observationPath,
              errors,
            )
            if (!EVIDENCE_SOURCES.has(observation.source)) {
              errors.push(`${observationPath}.source 不是允许值`)
            }
            if (typeof observation.locator !== "string" || observation.locator.length === 0) {
              errors.push(`${observationPath}.locator 必须是非空字符串`)
            }
            if (
              observation.text_excerpt !== null &&
              typeof observation.text_excerpt !== "string"
            ) {
              errors.push(`${observationPath}.text_excerpt 必须是字符串或 null`)
            }
            if (
              typeof observation.text_excerpt === "string" &&
              observation.text_excerpt.length > 280
            ) {
              errors.push(`${observationPath}.text_excerpt 最多 280 个字符`)
            }
          })
        }
      })
      if (
        Number.isInteger(collection?.visible_item_count) &&
        evidence.items.length > collection.visible_item_count
      ) {
        errors.push("$.evidence.items 不能多于 visible_item_count")
      }
    }
    if (
      !Array.isArray(evidence.warnings) ||
      evidence.warnings.some((warning) => typeof warning !== "string")
    ) {
      errors.push("$.evidence.warnings 必须是字符串数组")
    }
  }

  const safety = document.safety
  if (
    checkAllowedKeys(
      safety,
      new Set(["read_only", "account_write_performed", "stop_signal"]),
      "$.safety",
      errors,
    )
  ) {
    requireKeys(
      safety,
      ["read_only", "account_write_performed", "stop_signal"],
      "$.safety",
      errors,
    )
    if (safety.read_only !== true) {
      errors.push("$.safety.read_only 必须是 true")
    }
    if (safety.account_write_performed !== false) {
      errors.push("$.safety.account_write_performed 必须是 false")
    }
    if (!STOP_SIGNALS.has(safety.stop_signal)) {
      errors.push("$.safety.stop_signal 不是允许值")
    }
  }

  const statusToStop = {
    "results-visible": "none",
    "no-results-visible": "none",
    completed: "none",
    "login-required": "user-required",
    "challenge-required": "challenge-required",
    "rate-limited": "rate-limited",
    "layout-changed": "layout-changed",
    "policy-blocked": "policy-blocked",
    fatal: "fatal",
  }
  if (
    access?.status in statusToStop &&
    safety?.stop_signal !== statusToStop[access.status]
  ) {
    errors.push(
      `$.safety.stop_signal 必须与 access.status 对应为 ${statusToStop[access.status]}`,
    )
  }

  if (
    ["results-visible", "completed"].includes(access?.status) &&
    Array.isArray(evidence?.items) &&
    evidence.items.length === 0
  ) {
    errors.push(`access.status 为 ${access.status} 时 evidence.items 不能为空`)
  }

  return [...new Set(errors)]
}
