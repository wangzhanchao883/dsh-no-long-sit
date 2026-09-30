// mock 宿主契约回归：不启动 DSH，直接把 apply() 挂在假 ctx 上，逐个打路由。
// 覆盖：路由注册面、跨源拦截、GET/POST 语义、动作白名单、素材白名单、卸载清理、状态落盘。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, name, inject, Config } from '../index.mjs'
import { STATE_PATH, CHOICE_PATH, CASES_PATH, REFRESH_PATH, ART_PATH, BODY_LIMIT } from '../lib/routes.mjs'

const HOME = mkdtempSync(join(tmpdir(), 'nls-home-'))
process.env.DSH_HOME = HOME

function fakeReq({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const req = { method, url, headers }
  req[Symbol.asyncIterator] = async function* iterate() {
    if (body) yield Buffer.from(body, 'utf8')
  }
  return req
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers ?? null
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    },
  }
}

function createFakeCtx() {
  const routes = new Map()
  const cleanups = []
  const webServer = {
    register(route) {
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`duplicate route ${key}`)
      routes.set(key, route)
      return () => routes.delete(key)
    },
  }
  const ctx = {
    logger: { warn() {} },
    // cordis 的静态 inject 会把服务混进 ctx；这里同时提供两种取法，贴近真实运行面
    webServer,
    get(service) {
      if (service === 'webServer') return webServer
      return undefined
    },
    effect(fn) {
      const dispose = fn()
      cleanups.push(dispose)
      return dispose
    },
    inject(_names, callback) {
      callback(ctx)
    },
  }
  return { ctx, routes, cleanups }
}

async function call(route, options) {
  const res = fakeRes()
  await route.handler(fakeReq(options), res)
  return res
}

const sameOrigin = { 'sec-fetch-site': 'same-origin' }

test('插件形态：具名导出齐全，且没有 export default（有的话会盖掉 Config/apply）', () => {
  assert.equal(name, 'dsh-no-long-sit')
  assert.deepEqual(inject, ['webServer'])
  assert.ok(Config, 'Config schema 必须具名导出，否则设置页拿不到表单')
  assert.ok(Config.dict, 'Config 应是 schemastery object schema')
})

test('路由注册面 = 5 条绝对路径，且跨源请求被 403 拦下', async (t) => {
  const { ctx, routes, cleanups } = createFakeCtx()
  const dispose = apply(ctx, { timeScale: 0.001 })
  t.after(() => {
    dispose?.()
    for (const cleanup of cleanups) {
      try {
        cleanup?.()
      } catch {
        /* ignore */
      }
    }
    rmSync(HOME, { recursive: true, force: true })
  })

  for (const path of [STATE_PATH, CHOICE_PATH, CASES_PATH, REFRESH_PATH, ART_PATH]) {
    assert.equal(routes.has(`exact ${path}`), true, `缺少路由 ${path}`)
  }
  assert.equal(routes.size, 5)

  const blocked = await call(routes.get(`exact ${STATE_PATH}`), {
    url: STATE_PATH,
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(blocked.statusCode, 403)

  const ok = await call(routes.get(`exact ${STATE_PATH}`), { url: STATE_PATH, headers: sameOrigin })
  assert.equal(ok.statusCode, 200)
  const snap = JSON.parse(ok.body)
  assert.equal(snap.phase, 'focus')
  assert.equal(snap.address, '大人')
  assert.equal(snap.focusMinutes, 30)
  assert.equal(snap.enabled, true)
  // 设置卡片的「恢复默认值」依赖宿主下发字段清单与默认值
  assert.ok(Array.isArray(snap.configKeys) && snap.configKeys.includes('timeScale'), '快照必须带 configKeys')
  assert.equal(snap.defaults.timeScale, 1)
  assert.equal(snap.defaults.focusMinutes, 30)
  assert.equal(snap.configKeys.length, Object.keys(snap.defaults).length)
})

test('动作路由：白名单、非法动作、超大 body、状态推进', async (t) => {
  const { ctx, routes, cleanups } = createFakeCtx()
  const dispose = apply(ctx, { timeScale: 0.001 })
  t.after(() => {
    dispose?.()
    for (const cleanup of cleanups) cleanup?.()
    rmSync(HOME, { recursive: true, force: true })
  })
  const route = routes.get(`exact ${CHOICE_PATH}`)

  const wrongMethod = await call(route, { url: CHOICE_PATH, headers: sameOrigin })
  assert.equal(wrongMethod.statusCode, 405)

  const badAction = await call(route, {
    method: 'POST',
    url: CHOICE_PATH,
    headers: sameOrigin,
    body: JSON.stringify({ action: 'nuke' }),
  })
  assert.equal(badAction.statusCode, 400)

  const tooBig = await call(route, {
    method: 'POST',
    url: CHOICE_PATH,
    headers: sameOrigin,
    body: JSON.stringify({ action: 'finish', pad: 'x'.repeat(BODY_LIMIT) }),
  })
  assert.equal(tooBig.statusCode, 413)

  const finish = await call(route, {
    method: 'POST',
    url: CHOICE_PATH,
    headers: sameOrigin,
    body: JSON.stringify({ action: 'finish' }),
  })
  assert.equal(finish.statusCode, 200)
  const payload = JSON.parse(finish.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.state.phase, 'stopped')
  assert.ok(payload.state.summary, '结束必须带总结')
  assert.equal(typeof payload.state.summary.grade, 'string')

  // 已结束 → 再发动作 409
  const after = await call(route, {
    method: 'POST',
    url: CHOICE_PATH,
    headers: sameOrigin,
    body: JSON.stringify({ action: 'rest-done' }),
  })
  assert.equal(after.statusCode, 409)
})

test('素材路由：白名单命中返回动图，穿越/未知返回 404', async (t) => {
  const { ctx, routes, cleanups } = createFakeCtx()
  const dispose = apply(ctx, { timeScale: 0.001 })
  t.after(() => {
    dispose?.()
    for (const cleanup of cleanups) cleanup?.()
    rmSync(HOME, { recursive: true, force: true })
  })
  const route = routes.get(`exact ${ART_PATH}`)

  const idle = await call(route, { url: `${ART_PATH}?id=idle`, headers: sameOrigin })
  assert.equal(idle.statusCode, 200)
  assert.match(idle.headers['content-type'], /^image\/webp/)
  assert.equal(idle.body.startsWith('RIFF'), true, '动图 WebP 应以 RIFF 头开始')

  // 新协议：?f=<相对路径>（帧序列/动图/清单都走这条）
  const byRel = await call(route, { url: `${ART_PATH}?f=anim/idle.webp`, headers: sameOrigin })
  assert.equal(byRel.statusCode, 200)
  assert.match(byRel.headers['content-type'], /^image\/webp/)
  const manifest = await call(route, { url: `${ART_PATH}?f=pet-manifest.json`, headers: sameOrigin })
  assert.equal(manifest.statusCode, 200)
  const parsedManifest = JSON.parse(manifest.body)
  assert.equal(parsedManifest.version, 3)
  assert.ok(parsedManifest.states.idle, '清单必须描述 idle 状态')

  for (const id of ['../../package.json', 'random']) {
    const miss = await call(route, { url: `${ART_PATH}?id=${encodeURIComponent(id)}`, headers: sameOrigin })
    assert.equal(miss.statusCode, 404, `id=${id} 必须 404`)
  }
  for (const rel of ['../package.json', 'frames/../../index.mjs', 'evil.exe']) {
    const miss = await call(route, { url: `${ART_PATH}?f=${encodeURIComponent(rel)}`, headers: sameOrigin })
    assert.equal(miss.statusCode, 404, `f=${rel} 必须 404`)
  }
})

test('案例路由：返回内置库与刷新状态；无 llm/web 时刷新失败可见且保留旧库', async (t) => {
  const { ctx, routes, cleanups } = createFakeCtx()
  const dispose = apply(ctx, { timeScale: 0.001 })
  t.after(() => {
    dispose?.()
    for (const cleanup of cleanups) cleanup?.()
    rmSync(HOME, { recursive: true, force: true })
  })

  const cases = await call(routes.get(`exact ${CASES_PATH}`), { url: CASES_PATH, headers: sameOrigin })
  assert.equal(cases.statusCode, 200)
  const caseBody = JSON.parse(cases.body)
  assert.ok(Array.isArray(caseBody.cases))
  assert.ok(caseBody.cases.length >= 8, '内置案例库应随包分发')
  assert.equal(typeof caseBody.status.builtinCount, 'number')

  const refresh = await call(routes.get(`exact ${REFRESH_PATH}`), {
    method: 'POST',
    url: REFRESH_PATH,
    headers: sameOrigin,
  })
  // 假 ctx 没有 llm/web → 必须失败并且给出可读原因，而不是静默清空案例
  assert.equal(refresh.statusCode, 502)
  const refreshBody = JSON.parse(refresh.body)
  assert.equal(refreshBody.ok, false)
  assert.match(refreshBody.error, /llm|web|检索|模型/)
  const after = JSON.parse((await call(routes.get(`exact ${CASES_PATH}`), { url: CASES_PATH, headers: sameOrigin })).body)
  assert.equal(after.cases.length, caseBody.cases.length, '刷新失败必须保留旧库')
})

test('设置来自 settings.describe()（0.2 无 register），配置变化重锚当前阶段', async (t) => {
  const rows = [{
    ns: 'dsh-no-long-sit',
    value: { focusMinutes: 30, breakMinutes: 5, timeScale: 1 },
    user: { address: '老板', breakMinutes: 3, timeScale: 0.05, earlyBreakGuard: false },
  }]
  const { ctx, routes, cleanups } = createFakeCtx()
  const webServer = ctx.webServer
  ctx.get = (service) => {
    if (service === 'settings') return { describe: () => rows }
    if (service === 'webServer') return webServer
    return undefined
  }
  const dispose = apply(ctx, {})
  t.after(() => {
    dispose?.()
    for (const cleanup of cleanups) cleanup?.()
    rmSync(HOME, { recursive: true, force: true })
  })

  const snap = JSON.parse((await call(routes.get(`exact ${STATE_PATH}`), { url: STATE_PATH, headers: sameOrigin })).body)
  assert.equal(snap.address, '老板')
  assert.equal(snap.breakMinutes, 3)
  assert.equal(snap.timeScale, 0.05)
  assert.equal(snap.earlyBreakGuard, false)
  assert.equal(snap.cfgSource, 'user')
  // 配置生效后当前 focus 阶段按 timeScale 重锚：30 分钟 × 0.05 = 90_000ms
  assert.equal(snap.phaseEndsAt - snap.phaseStartedAt, 90000)
})

test('落盘与卸载：动作后写 state.json，dispose 后路由全部注销', async (t) => {
  const { ctx, routes, cleanups } = createFakeCtx()
  const dispose = apply(ctx, { timeScale: 0.001 })

  await call(routes.get(`exact ${CHOICE_PATH}`), {
    method: 'POST',
    url: CHOICE_PATH,
    headers: sameOrigin,
    body: JSON.stringify({ action: 'finish' }),
  })
  const stateFile = join(HOME, 'data', 'dsh-no-long-sit', 'state.json')
  assert.equal(existsSync(stateFile), true, '结束必须落盘')
  const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(saved.phase, 'stopped')

  const routeCount = routes.size
  assert.equal(routeCount, 5)
  dispose?.()
  for (const cleanup of cleanups) cleanup?.()
  assert.equal(routes.size, 0, 'dispose 后不能残留路由')
  rmSync(HOME, { recursive: true, force: true })
})
