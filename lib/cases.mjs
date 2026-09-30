// 案例库：内置真实案例（assets/cases.json）+ 启动后台刷新（宿主 web 检索 + 宿主 LLM 改写）。
//
// 红线：案例必须可溯源。刷新产物只保留「url 出现在本次检索结果里」的条目，
// 且要求 title/fact/url 齐全；校验不过的条目一律丢弃，绝不静默用模型口述填空。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILTIN_FILE = join(import.meta.dirname, '..', 'assets', 'cases.json')
const MAX_CASES = 40
const REFRESH_QUERIES = [
  '久坐 深静脉血栓 肺栓塞 真实案例 新闻',
  '久坐 不喝水 肾结石 脱水 送医 案例',
]

/** 单条案例形状校验。 */
export function isValidCase(item) {
  if (!item || typeof item !== 'object') return false
  if (item.kind !== 'sit' && item.kind !== 'water') return false
  if (typeof item.title !== 'string' || item.title.trim().length === 0) return false
  if (typeof item.fact !== 'string' || item.fact.trim().length < 10) return false
  if (typeof item.url !== 'string' || !/^https?:\/\//.test(item.url)) return false
  return true
}

/** 载入内置案例库（随包分发；损坏时返回空表而不是炸掉插件）。 */
export function loadBuiltin() {
  try {
    const raw = JSON.parse(readFileSync(BUILTIN_FILE, 'utf8'))
    const cases = Array.isArray(raw?.cases) ? raw.cases.filter(isValidCase) : []
    return { version: raw?.version ?? 1, updatedAt: raw?.updatedAt ?? null, cases }
  } catch {
    return { version: 1, updatedAt: null, cases: [] }
  }
}

/** 合并内置 + 刷新结果：按 url 去重，刷新结果优先（更新的事实）。 */
export function mergeCases(builtin, refreshed, limit = MAX_CASES) {
  const byUrl = new Map()
  for (const item of refreshed ?? []) {
    if (isValidCase(item)) byUrl.set(item.url, { ...item, origin: 'refresh' })
  }
  for (const item of builtin ?? []) {
    if (isValidCase(item) && !byUrl.has(item.url)) byUrl.set(item.url, { ...item, origin: 'builtin' })
  }
  return [...byUrl.values()].slice(0, limit)
}

/**
 * 过滤刷新产物：只留 URL 在检索来源白名单里的条目（防模型编造来源）。
 * @param {unknown} items 模型返回的数组
 * @param {Array<{url?:string}>} sources 宿主检索返回的 sources
 */
export function filterRefreshed(items, sources) {
  const urls = new Set((sources ?? []).map((s) => s?.url).filter((u) => typeof u === 'string'))
  if (urls.size === 0) return []
  const out = []
  for (const item of Array.isArray(items) ? items : []) {
    if (!isValidCase(item)) continue
    if (!urls.has(item.url)) continue
    out.push({
      kind: item.kind,
      title: String(item.title).trim().slice(0, 40),
      fact: String(item.fact).trim().slice(0, 240),
      url: item.url,
      source: typeof item.source === 'string' ? item.source.trim().slice(0, 40) : '',
      publishedAt: typeof item.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.publishedAt)
        ? item.publishedAt
        : null,
    })
  }
  return out
}

function buildPrompt(sources) {
  const lines = sources.map((s, i) => `[${i + 1}] ${s.title ?? ''} ${s.url}\n${(s.snippet ?? '').slice(0, 400)}`)
  return [
    '你是健康科普编辑。下面是检索到的真实来源，请据此整理 6 条中文短案例，供久坐提醒弹窗展示。',
    '要求：',
    '1. 每条 60-120 字，说清"发生了什么/研究发现了什么"，语气克制、有冲击力但不夸张。',
    '2. 严禁编造来源里没有的时间、地点、人名、数字、机构；不确定就不要写。',
    '3. 每条必须带真实来源 url（只能从下面给出的 url 里选）。',
    '4. kind 取 "sit"（久坐相关）或 "water"（缺水/不喝水相关），两类都要有。',
    '5. 只输出 JSON 数组，不要解释、不要 markdown 代码块：',
    '[{"kind":"sit","title":"","fact":"","url":"","source":"","publishedAt":"YYYY-MM-DD 或 null"}]',
    '',
    ...lines,
  ].join('\n')
}

function stripFence(text) {
  return String(text ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
}

/**
 * 走宿主通道刷新案例库。
 * @returns {Promise<{ok:boolean, cases?:Array, meta:object, error?:string}>}
 */
export async function refreshCases(ctx, { signal, logger } = {}) {
  const llm = ctx.get?.('llm')
  const web = ctx.get?.('web')
  const meta = { attemptedAt: Date.now(), queryCount: 0, sourceCount: 0, kept: 0 }
  if (typeof llm?.stream !== 'function') return { ok: false, meta, error: '宿主未提供 llm 服务' }

  // 1) 检索（拿不到凭据时直接失败，可见地保留旧库）
  let sources = []
  if (typeof web?.search === 'function') {
    for (const query of REFRESH_QUERIES) {
      try {
        const res = await web.search({ query, maxResults: 6 }, signal)
        const list = Array.isArray(res?.sources) ? res.sources : []
        sources = sources.concat(list)
        meta.queryCount += 1
      } catch (error) {
        logger?.(`案例检索失败：${error?.message ?? error}`)
        if (sources.length === 0) {
          return { ok: false, meta, error: `检索失败：${error?.message ?? String(error)}` }
        }
      }
    }
  } else {
    return { ok: false, meta, error: '宿主未提供 web 检索服务（无法保证案例可溯源）' }
  }
  const dedup = new Map()
  for (const s of sources) if (s?.url) dedup.set(s.url, s)
  sources = [...dedup.values()]
  meta.sourceCount = sources.length
  if (sources.length === 0) return { ok: false, meta, error: '检索无结果' }

  // 2) 模型改写（插件调 LLM 一律关推理，避免推理吃掉 token 预算）
  const route = ctx.get?.('agentDefaultModel')?.currentSelection?.() ?? null
  const provider = route?.provider ?? llm.listProviders?.()?.[0]?.id
  let model = route?.model
  if (!model && provider) {
    try {
      const models = await llm.listModels(provider)
      model = Array.isArray(models) ? models[0]?.id : undefined
    } catch {
      /* 保持 undefined，下面会报错 */
    }
  }
  if (!provider || !model) return { ok: false, meta, error: '无法解析宿主模型路由' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  const merged = signal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, controller.signal])
    : (signal ?? controller.signal)
  let text = ''
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(sources) }] }],
      reasoningEffort: 'off',
      maxTokens: 8000,
      signal: merged,
    })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        return { ok: false, meta, error: `LLM 失败：${chunk.reason?.failure?.code ?? chunk.reason?.kind}` }
      }
    }
  } catch (error) {
    return { ok: false, meta, error: `LLM 异常：${error?.message ?? String(error)}` }
  } finally {
    clearTimeout(timer)
  }

  let parsed
  try {
    parsed = JSON.parse(stripFence(text))
  } catch {
    return { ok: false, meta, error: '模型未返回可解析 JSON（按失败处理，保留旧库）' }
  }
  const kept = filterRefreshed(parsed, sources)
  meta.kept = kept.length
  if (kept.length === 0) return { ok: false, meta, error: '刷新结果全部无法溯源，已丢弃' }
  return { ok: true, cases: kept, meta }
}
