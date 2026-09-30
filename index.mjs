// dsh-no-long-sit · host 半身
//
// 职责：权威计时（host 侧，刷新页面不丢）+ 会话账本 + 案例库 + 只读/动作路由 + 素材服务。
// 弹窗本身由 client 半身（client.js）用 shell.overlay 渲染，本文件不碰 UI。
//
// 契约备忘（DSH 0.1.7 / 0.2.0-rc.2 实测）：
// - 绝不能 `export default`：loader 的 unwrapExports 会让它盖掉具名导出（Config/apply 全失效）。
// - 定时器随 fiber 生命期：用 ctx.effect 包 setInterval 并在 disposer 里清掉。
// - webServer.register 的路由不在 /api 信任栅栏内 → 每个 handler 自己查跨源。
// - 没有 ctx.on('ready'/'dispose') 这种生命周期事件；清理 = effect disposer / apply 返回值。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildSchema, normalizeConfig, NS } from './lib/config.mjs'
import { createState, tick, choose, snapshot, scaledMs } from './lib/state.mjs'
import { loadJson, saveJsonAtomic, appendLog, statePath, casesCachePath } from './lib/store.mjs'
import { loadBuiltin, mergeCases, refreshCases } from './lib/cases.mjs'
import {
  STATE_PATH, CHOICE_PATH, CASES_PATH, REFRESH_PATH, ART_PATH, BODY_LIMIT,
  json, isCrossOrigin, readBody, parseAction, artFileFor, artContentType,
  sanitizeAssetRel, assetContentType, FALLBACK_PET_SVG,
} from './lib/routes.mjs'

export const name = 'dsh-no-long-sit'

// 只静态依赖 webServer（不可缺席）。settings / llm / web 一律惰性 ctx.get，
// 缺失时插件照样激活，只是退化成"无配置面 / 无案例刷新"。
export const inject = ['webServer']

/** 设置页 schema（loader 从 entry.fiber.runtime.Config 读取，用于表单投影）。 */
export const Config = buildSchema()

export { NS }

const TICK_MS = 1000
const SAVE_DEBOUNCE_MS = 1000
const MAX_STATE_AGE_MS = 12 * 60 * 60 * 1000
const ASSETS_DIR = join(import.meta.dirname, 'assets')

/** 恢复上次会话：太旧或已结束的一律重开，避免开机就弹一个几小时前的总结。 */
function restoreState(now, cfg) {
  const saved = loadJson(statePath(), null)
  if (!saved || typeof saved !== 'object') return createState(now, cfg)
  const updatedAt = Number(saved.updatedAt)
  if (!Number.isFinite(updatedAt) || now - updatedAt > MAX_STATE_AGE_MS) return createState(now, cfg)
  if (saved.phase === 'stopped') return createState(now, cfg)
  return {
    ...createState(now, cfg),
    ...saved,
    // 关键字段强制类型/范围，防手改文件把状态机带崩
    phase: ['focus', 'break', 'awaitReturn'].includes(saved.phase) ? saved.phase : 'focus',
    phaseEndsAt: Number.isFinite(Number(saved.phaseEndsAt)) ? Number(saved.phaseEndsAt) : now,
    focusRounds: Math.max(0, Math.floor(Number(saved.focusRounds) || 0)),
    breaksTaken: Math.max(0, Math.floor(Number(saved.breaksTaken) || 0)),
    breakOpportunities: Math.max(0, Math.floor(Number(saved.breakOpportunities) || 0)),
    snoozeTotal: Math.max(0, Math.floor(Number(saved.snoozeTotal) || 0)),
    overSnooze: Math.max(0, Math.floor(Number(saved.overSnooze) || 0)),
    missedBreaks: Math.max(0, Math.floor(Number(saved.missedBreaks) || 0)),
  }
}

export function apply(ctx, input = {}) {
  const now0 = Date.now()
  let disposed = false

  const log = (message) => {
    try {
      ctx.logger?.warn?.(`[dsh-no-long-sit] ${message}`)
    } catch {
      /* ignore */
    }
    appendLog({ level: 'warn', message })
  }

  // ---- 配置 ----
  // 契约（0.1.7 / 0.2.0-rc.2 实测）：
  // - apply(ctx, input) 的 input 是宿主已解析的配置（含 schema 默认值 + profile 覆盖）；
  // - settings 服务只「投影」不「通知」：面板写入落 <profile>/cordis.patch.yml 后**不会**重新 apply 本插件，
  //   所以权威读法是 settings.describe()，而且必须在**每个入口**重读，否则运行期一直用加载那一刻的旧值。
  // - describe() 是内存操作，成本可忽略；row.user 只含显式字段，row.value 含默认值 —— 优先用 user，
  //   避免默认值把 entry 里的显式配置冲掉。
  const entryCfg = input && typeof input === 'object' ? input : {}
  let cfg = normalizeConfig(entryCfg)
  let cfgSource = 'entry'
  let cfgRevision = 0
  let settingsService = typeof ctx.get === 'function' ? ctx.get('settings') : undefined
  const syncFromSettings = () => {
    if (!settingsService || typeof settingsService.describe !== 'function') return
    try {
      const rows = settingsService.describe()
      const row = Array.isArray(rows) ? rows.find((it) => it && it.ns === NS) : null
      if (!row) return
      const user = row.user && typeof row.user === 'object' ? row.user : null
      const value = row.value && typeof row.value === 'object' ? row.value : null
      const layer = user ?? value
      if (!layer || Object.keys(layer).length === 0) return
      const next = normalizeConfig({ ...entryCfg, ...layer })
      if (JSON.stringify(next) !== JSON.stringify(cfg)) {
        cfg = next
        cfgRevision += 1
      }
      cfgSource = user ? 'user' : 'value'
    } catch {
      /* describe 失败保持现有配置（不阻塞插件） */
    }
  }
  if (!settingsService && typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (child) => {
      settingsService = child.settings
      syncFromSettings()
    })
  }
  syncFromSettings()

  // 会话状态（配置就绪后再恢复，保证时长口径用的是生效配置）
  let state = restoreState(now0, cfg)
  let appliedRevision = cfgRevision

  /**
   * 每个入口的「取当前最新配置」：重读 settings + 若配置变了就重锚当前阶段。
   * 为什么要重锚：settings 服务只投影不通知，面板写入不会重新 apply；
   * 而且 0.2 启动早期 describe() 可能还拿不到 profile 覆盖，首帧会先按默认值起表。
   */
  const refreshConfig = () => {
    syncFromSettings()
    if (cfgRevision === appliedRevision) return
    appliedRevision = cfgRevision
    if (state.phase === 'focus' || state.phase === 'break') {
      const minutes = state.phase === 'focus' ? cfg.focusMinutes : cfg.breakMinutes
      state = { ...state, phaseEndsAt: state.phaseStartedAt + scaledMs(cfg, minutes), updatedAt: Date.now() }
    }
  }

  // ---- 案例库：内置打底 + 运行期缓存（刷新结果落到 <DSH_HOME>/data/.../cases-cache.json） ----
  const builtin = loadBuiltin()
  const cache = loadJson(casesCachePath(), null)
  let refreshed = Array.isArray(cache?.cases) ? cache.cases : []
  let caseStatus = {
    lastAttemptAt: Number(cache?.lastAttemptAt) || null,
    lastSuccessAt: Number(cache?.lastSuccessAt) || null,
    lastError: typeof cache?.lastError === 'string' ? cache.lastError : null,
    refreshedCount: refreshed.length,
    builtinCount: builtin.cases.length,
  }
  const currentCases = () => mergeCases(builtin.cases, refreshed)

  // ---- 持久化（防抖 + 卸载前末次落盘） ----
  let saveTimer = null
  const saveNow = () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saveJsonAtomic(statePath(), state)
  }
  const scheduleSave = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveJsonAtomic(statePath(), state)
    }, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }
  const persistCases = () => {
    saveJsonAtomic(casesCachePath(), { version: 1, ...caseStatus, cases: refreshed })
  }

  const publicSnapshot = () => snapshot(state, cfg, Date.now(), {
    enabled: cfg.enabled,
    caseCount: currentCases().length,
    caseStatus,
    cfgSource,
    soundEnabled: cfg.soundEnabled,
    soundVolume: cfg.soundVolume,
    petOpacity: cfg.petOpacity,
    awaitReturnTimeoutMinutes: cfg.awaitReturnTimeoutMinutes,
    autoResumed: state.autoResumed ?? 0,
  })

  // ---- 权威计时：1s 一跳，驱动阶段切换；顺带每 2 秒重读一次设置（面板改完 ≤2s 生效） ----
  let syncCountdown = 0
  const stopTick = ctx.effect(() => {
    const timer = setInterval(() => {
      if (disposed) return
      syncCountdown += 1
      if (syncCountdown % 2 === 0) refreshConfig()
      if (!cfg.enabled) return
      const result = tick(state, Date.now(), cfg)
      if (result.changed) {
        state = result.state
        scheduleSave()
      }
    }, TICK_MS)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'dsh-no-long-sit: tick')

  // ---- 路由 ----
  const disposers = []
  const guard = (req, res) => {
    if (isCrossOrigin(req)) {
      json(res, 403, { error: 'cross-origin request rejected' })
      return false
    }
    return true
  }
  const register = (route) => {
    try {
      disposers.push(ctx.webServer.register(route))
    } catch (error) {
      log(`路由注册失败 ${route.path}：${error?.message ?? error}`)
    }
  }

  register({
    kind: 'exact',
    path: STATE_PATH,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        return
      }
      refreshConfig()
      json(res, 200, publicSnapshot())
    },
  })

  register({
    kind: 'exact',
    path: CHOICE_PATH,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
        return
      }
      const raw = await readBody(req, BODY_LIMIT)
      if (raw === null) {
        json(res, 413, { error: 'body too large' })
        return
      }
      const action = parseAction(raw)
      if (!action) {
        json(res, 400, { error: 'invalid action' })
        return
      }
      refreshConfig()
      const result = choose(state, action, cfg, Date.now())
      if (result.ok) {
        state = result.state
        saveNow()
        appendLog({
          level: 'info',
          event: 'choice',
          action,
          phase: state.phase,
          focusRounds: state.focusRounds,
          breaksTaken: state.breaksTaken,
        })
      }
      json(res, result.ok ? 200 : 409, { ok: result.ok, reason: result.reason ?? null, state: publicSnapshot() })
    },
  })

  register({
    kind: 'exact',
    path: CASES_PATH,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'method not allowed' }, { allow: 'GET' })
        return
      }
      json(res, 200, { cases: currentCases(), status: caseStatus })
    },
  })

  register({
    kind: 'exact',
    path: REFRESH_PATH,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
        return
      }
      const outcome = await runCaseRefresh('manual')
      json(res, outcome.ok ? 200 : 502, { ok: outcome.ok, error: outcome.error ?? null, status: caseStatus })
    },
  })

  register({
    kind: 'exact',
    path: ART_PATH,
    handler: async (req, res) => {
      const url = new URL(req.url ?? ART_PATH, 'http://dsh.internal')
      // 新协议：?f=<相对 assets/ 的路径>（帧序列、动图、静态图都能走）；
      // 旧协议 ?id=<状态> 继续可用（映射到内置 SVG）。
      // 注意：显式给了 f 就严格校验，非法必须 404 —— 不能回落成默认图（否则穿越尝试会"成功"）。
      const relParam = url.searchParams.get('f')
      const legacyId = url.searchParams.get('id')
      const rel = relParam === null ? artFileFor(legacyId ?? 'idle') : sanitizeAssetRel(relParam)
      if (!rel) {
        json(res, 404, { error: 'unknown asset' })
        return
      }
      try {
        const data = readFileSync(join(ASSETS_DIR, rel))
        res.writeHead(200, {
          'content-type': relParam === null ? artContentType(legacyId ?? 'idle') : assetContentType(rel),
          'cache-control': 'public, max-age=3600',
        })
        res.end(data)
      } catch {
        // 素材缺失也不让宠物消失：发兜底 SVG
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' })
        res.end(FALLBACK_PET_SVG)
      }
    },
  })

  // ---- 案例刷新：启动后 delayed（默认 10 分钟）跑一次；失败保留旧库且原因可见 ----
  let refreshTimer = null
  let refreshing = false
  async function runCaseRefresh(trigger) {
    if (refreshing) return { ok: false, error: '已有刷新在进行' }
    refreshing = true
    caseStatus = { ...caseStatus, lastAttemptAt: Date.now(), lastError: null, trigger }
    try {
      const outcome = await refreshCases(ctx, { logger: log })
      if (outcome.ok) {
        refreshed = outcome.cases
        caseStatus = {
          ...caseStatus,
          lastSuccessAt: Date.now(),
          lastError: null,
          refreshedCount: refreshed.length,
          builtinCount: builtin.cases.length,
          sourceCount: outcome.meta.sourceCount,
          kept: outcome.meta.kept,
        }
        appendLog({ level: 'info', event: 'cases-refreshed', count: refreshed.length, trigger })
      } else {
        caseStatus = { ...caseStatus, lastError: outcome.error ?? '未知失败' }
        log(`案例刷新失败（保留旧库）：${caseStatus.lastError}`)
      }
      persistCases()
      return outcome
    } finally {
      refreshing = false
    }
  }
  if (cfg.caseRefreshEnabled) {
    const scale = Number.isFinite(cfg.timeScale) && cfg.timeScale > 0 ? cfg.timeScale : 1
    const delayMs = Math.max(5000, cfg.caseRefreshDelayMinutes * 60000 * scale)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      runCaseRefresh('startup')
    }, delayMs)
    refreshTimer.unref?.()
  }

  // ---- 卸载清理 ----
  return () => {
    disposed = true
    if (refreshTimer) clearTimeout(refreshTimer)
    saveNow()
    stopTick?.()
    for (const dispose of disposers) {
      try {
        dispose?.()
      } catch {
        /* ignore */
      }
    }
  }
}
