// HTTP 路由常量与请求工具（零依赖，可单测）。
//
// 安全契约：webServer.register 注册的路由**不在** /api 信任栅栏内
// （那是 dsh-client-connection 的领域）。所以每个路由都要自己拦跨源请求，
// 见 isCrossOrigin()：依赖浏览器发的 sec-fetch-site / Origin 头。
export const ROUTE_PREFIX = '/dsh-no-long-sit'
export const STATE_PATH = `${ROUTE_PREFIX}/state`
export const CHOICE_PATH = `${ROUTE_PREFIX}/choice`
export const CASES_PATH = `${ROUTE_PREFIX}/cases`
export const REFRESH_PATH = `${ROUTE_PREFIX}/refresh-cases`
export const ART_PATH = `${ROUTE_PREFIX}/art`

/** 动作请求体上限（几个字节足够，防滥用）。 */
export const BODY_LIMIT = 512

export const ACTIONS = Object.freeze(['rest-done', 'work-start', 'snooze', 'resume', 'finish', 'start'])

/** 统一 JSON 响应。 */
export function json(res, status, body, extra = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  })
  res.end(JSON.stringify(body))
}

/**
 * 跨源判定：同源页面的 fetch 会带 sec-fetch-site: same-origin。
 * 无 sec-fetch-site 的老客户端回落到 Origin/Host 比对；都没有则放行（本机直连 curl）。
 */
export function isCrossOrigin(req) {
  const headers = req?.headers ?? {}
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site.length > 0) {
    if (site !== 'same-origin' && site !== 'none') return true
    return false
  }
  const origin = headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return false
  const host = headers.host
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

/** 读取请求体；超限返回 null（调用方回 413）。 */
export async function readBody(req, limit = BODY_LIMIT) {
  let data = ''
  for await (const chunk of req) {
    data += chunk
    if (data.length > limit) return null
  }
  return data
}

/** 解析动作请求体：必须是 {action: <白名单>}。 */
export function parseAction(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw)
    const action = parsed?.action
    return ACTIONS.includes(action) ? action : null
  } catch {
    return null
  }
}

/** 旧版按状态 id 取素材（保持向后兼容）。 */
export const ART_FILES = Object.freeze({
  idle: 'anim/idle.webp',
  rise: 'anim/rise.webp',
  drink: 'anim/drink.webp',
  sleep: 'anim/sleep.webp',
  manifest: 'pet-manifest.json',
})

export function artFileFor(id) {
  return Object.prototype.hasOwnProperty.call(ART_FILES, id) ? ART_FILES[id] : null
}

export function artContentType(id) {
  const file = artFileFor(id)
  return file ? assetContentType(file) : 'image/svg+xml; charset=utf-8'
}

/** 允许通过 /art?f= 下发的素材扩展名 → content-type。 */
const ASSET_TYPES = Object.freeze({
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
})

/**
 * 素材相对路径净化：只放行 assets/ 下的白名单扩展名，拒绝穿越与绝对路径。
 * @returns {string|null} 规范化后的相对路径，非法返回 null
 */
export function sanitizeAssetRel(rel) {
  if (typeof rel !== 'string') return null
  const norm = rel.replace(/\\/g, '/').trim()
  if (norm.length === 0 || norm.length > 240) return null
  if (norm.startsWith('/') || norm.startsWith('./') || norm.includes('..') || norm.includes('//')) return null
  if (!/^[A-Za-z0-9._/-]+$/.test(norm)) return null
  const dot = norm.lastIndexOf('.')
  if (dot < 0) return null
  const ext = norm.slice(dot).toLowerCase()
  return Object.prototype.hasOwnProperty.call(ASSET_TYPES, ext) ? norm : null
}

export function assetContentType(rel) {
  const dot = String(rel).lastIndexOf('.')
  return ASSET_TYPES[String(rel).slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** 兜底猫猫 SVG（素材缺失时保证宠物画得出来）。 */
export const FALLBACK_PET_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">',
  '<path d="M64 64 L54 26 L94 48 Z" fill="#BFE0FF" stroke="#4A90D9" stroke-width="3" stroke-linejoin="round"/>',
  '<path d="M136 64 L146 26 L106 48 Z" fill="#BFE0FF" stroke="#4A90D9" stroke-width="3" stroke-linejoin="round"/>',
  '<ellipse cx="100" cy="152" rx="54" ry="34" fill="#FFFFFF" stroke="#D6EBFF" stroke-width="3"/>',
  '<path d="M150 150 q24 -8 18 -30" fill="none" stroke="#BFE0FF" stroke-width="9" stroke-linecap="round"/>',
  '<circle cx="100" cy="92" r="44" fill="#BFE0FF" stroke="#4A90D9" stroke-width="3"/>',
  '<path d="M78 92 q8 8 16 0" fill="none" stroke="#4A90D9" stroke-width="4" stroke-linecap="round"/>',
  '<path d="M106 92 q8 8 16 0" fill="none" stroke="#4A90D9" stroke-width="4" stroke-linecap="round"/>',
  '<path d="M96 108 q4 5 8 0" fill="none" stroke="#4A90D9" stroke-width="3" stroke-linecap="round"/>',
  '<circle cx="72" cy="106" r="6" fill="#FFB6C1" opacity="0.75"/>',
  '<circle cx="128" cy="106" r="6" fill="#FFB6C1" opacity="0.75"/>',
  '</svg>',
].join('')
