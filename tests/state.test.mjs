// 状态机单测：纯函数，不依赖宿主。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createState, tick, choose, summarize, evaluate, snapshot, scaledMs, PHASES,
} from '../lib/state.mjs'
import { normalizeConfig } from '../lib/config.mjs'

const cfg = normalizeConfig({ focusMinutes: 30, breakMinutes: 5, snoozeMinutes: 5, maxSnooze: 2, timeScale: 1 })
const T0 = 1_800_000_000_000

test('新会话从 focus 开始，倒计时等于专注周期', () => {
  const s = createState(T0, cfg)
  assert.equal(s.phase, 'focus')
  assert.equal(s.phaseEndsAt - T0, 30 * 60000)
  assert.deepEqual(PHASES.includes(s.phase), true)
})

test('专注到点 → break：focusRounds +1，弹窗次数 +1，休息倒计时等于休息周期', () => {
  let s = createState(T0, cfg)
  const r = tick(s, T0 + 30 * 60000, cfg)
  assert.equal(r.changed, true)
  s = r.state
  assert.equal(s.phase, 'break')
  assert.equal(s.focusRounds, 1)
  assert.equal(s.breakOpportunities, 1)
  assert.equal(s.phaseEndsAt - s.phaseStartedAt, 5 * 60000)
})

test('休息跑完 → awaitReturn：记一次成功中断，不重复计数', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  s = tick(s, T0 + 35 * 60000, cfg).state
  assert.equal(s.phase, 'awaitReturn')
  assert.equal(s.breaksTaken, 1)
  const again = tick(s, T0 + 36 * 60000, cfg)
  assert.equal(again.changed, false)
  assert.equal(again.state.breaksTaken, 1)
})

test('休息中提前点【休息好了】→ 直接下一轮专注，并记一次中断', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  const r = choose(s, 'rest-done', cfg, T0 + 31 * 60000)
  assert.equal(r.ok, true)
  assert.equal(r.early, true)
  assert.equal(r.state.phase, 'focus')
  assert.equal(r.state.breaksTaken, 1)
  assert.equal(r.state.phaseEndsAt - (T0 + 31 * 60000), 30 * 60000)
})

test('awaitReturn 点【开始干活】不重复计中断', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  s = tick(s, T0 + 35 * 60000, cfg).state
  const r = choose(s, 'work-start', cfg, T0 + 36 * 60000)
  assert.equal(r.ok, true)
  assert.equal(r.early, false)
  assert.equal(r.state.breaksTaken, 1)
  assert.equal(r.state.phase, 'focus')
})

test('【再等会】超上限记一次未中断，并设置重弹时间', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  const a = choose(s, 'snooze', cfg, T0 + 30 * 60000)
  const b = choose(a.state, 'snooze', cfg, T0 + 30 * 60000)
  const c = choose(b.state, 'snooze', cfg, T0 + 30 * 60000)
  assert.equal(a.over, false)
  assert.equal(b.over, false)
  assert.equal(c.over, true)
  assert.equal(c.state.snoozeTotal, 3)
  assert.equal(c.state.overSnooze, 1)
  assert.equal(c.state.missedBreaks, 1)
  assert.equal(c.state.snoozeUntil - (T0 + 30 * 60000), 5 * 60000)
})

test('【结束】出总结并进入 stopped；再发动作一律拒绝', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  s = choose(s, 'rest-done', cfg, T0 + 31 * 60000).state
  const r = choose(s, 'finish', cfg, T0 + 61 * 60000)
  assert.equal(r.ok, true)
  assert.equal(r.state.phase, 'stopped')
  assert.equal(r.summary.workMs, 61 * 60000)
  assert.equal(r.summary.focusRounds, 1)
  assert.equal(r.summary.breaksTaken, 1)
  assert.equal(r.summary.suggestedDrinks, 1)
  assert.equal(r.summary.grade, 'good')
  const after = choose(r.state, 'rest-done', cfg, T0 + 62 * 60000)
  assert.equal(after.ok, false)
  assert.equal(after.reason, 'stopped')
})

test('【再等会】可被 resume 收回（案例看完立刻恢复提醒，不计暂缓次数）', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  const snoozed = choose(s, 'snooze', cfg, T0 + 30 * 60000).state
  assert.ok(snoozed.snoozeUntil > 0)
  const resumed = choose(snoozed, 'resume', cfg, T0 + 30 * 60000)
  assert.equal(resumed.ok, true)
  assert.equal(resumed.state.snoozeUntil, 0)
  assert.equal(resumed.state.snoozeTotal, 1, 'resume 不该改变暂缓次数')
})

test('休息跑完进入「回来干活」时清掉 snooze（新阶段必须立刻提醒）', () => {
  let s = createState(T0, cfg)
  s = tick(s, T0 + 30 * 60000, cfg).state
  s = choose(s, 'snooze', cfg, T0 + 30 * 60000).state
  assert.ok(s.snoozeUntil > 0)
  s = tick(s, T0 + 35 * 60000, cfg).state
  assert.equal(s.phase, 'awaitReturn')
  assert.equal(s.snoozeUntil, 0)
  assert.equal(s.snoozeCount, 0)
})

test('「回来干活」等太久会兜底自动开下一轮，避免流程永久卡死', () => {
  const slow = normalizeConfig({ ...cfg, awaitReturnTimeoutMinutes: 10 })
  let s = createState(T0, slow)
  s = tick(s, T0 + 30 * 60000, slow).state
  s = tick(s, T0 + 35 * 60000, slow).state
  assert.equal(s.phase, 'awaitReturn')
  const notYet = tick(s, T0 + 35 * 60000 + 9 * 60000, slow)
  assert.equal(notYet.changed, false)
  const auto = tick(s, T0 + 35 * 60000 + 10 * 60000, slow)
  assert.equal(auto.changed, true)
  assert.equal(auto.state.phase, 'focus')
  assert.equal(auto.state.autoResumed, 1)
  assert.equal(auto.state.breaksTaken, 1, '自动继续不该重复计中断')
})

test('等待上限配成 0 时不自动继续（保持等人确认）', () => {
  const off = normalizeConfig({ ...cfg, awaitReturnTimeoutMinutes: 0 })
  let s = createState(T0, off)
  s = tick(s, T0 + 30 * 60000, off).state
  s = tick(s, T0 + 35 * 60000, off).state
  const later = tick(s, T0 + 24 * 3600 * 1000, off)
  assert.equal(later.changed, false)
  assert.equal(later.state.phase, 'awaitReturn')
})

test('评价规则：命中率与超限暂缓共同决定好/中/差', () => {
  const base = { focusRounds: 2, hitRatio: 1, overSnooze: 0 }
  assert.equal(evaluate(base, cfg), 'good')
  assert.equal(evaluate({ ...base, overSnooze: 1 }, cfg), 'mid')
  assert.equal(evaluate({ ...base, hitRatio: 0.6 }, cfg), 'mid')
  assert.equal(evaluate({ ...base, hitRatio: 0.2 }, cfg), 'bad')
  assert.equal(evaluate({ focusRounds: 0, hitRatio: 0, overSnooze: 0 }, cfg), 'bad')
})

test('时间缩放只影响时长计算，且有 1s 下限', () => {
  const fast = normalizeConfig({ ...cfg, focusMinutes: 30, timeScale: 0.001 })
  assert.equal(scaledMs(fast, 30), 1800)
  assert.equal(scaledMs(fast, 3), 1000)
})

test('快照带绝对时间戳与派生长度，客户端可本地算倒计时', () => {
  const s = createState(T0, cfg)
  const snap = snapshot(s, cfg, T0 + 60000, { enabled: true })
  assert.equal(snap.phase, 'focus')
  assert.equal(snap.remainingMs, 29 * 60000)
  assert.equal(snap.sessionMs, 60000)
  assert.equal(snap.address, cfg.address)
  assert.equal(snap.enabled, true)
})
