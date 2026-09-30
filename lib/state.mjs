// 状态机（纯函数、零依赖、可单测）。
//
// 业务语义（用户 2026-09-30 定稿）：
//   focus（专注倒计时）--到点--> break（休息倒计时 + 弹窗喊你起来走动/喝水）
//   break 倒计时跑完 --> awaitReturn（弹窗文案变「回来干活」）--用户点确认--> focus
//   break 中途点【休息好了】= 已休息好，直接进下一轮 focus（同样记一次成功中断）
//   【再等会】= 弹伤害案例窗，snoozeMinutes 后重新弹提醒；每轮超 maxSnooze 记一次未中断
//   【结束】= 结算本次会话，出总结与好/中/差评价，进入 stopped
// 时间一律用绝对 epoch 毫秒；timeScale 只用于调试加速。
export const PHASES = Object.freeze(['focus', 'break', 'awaitReturn', 'stopped'])

const MINUTE_MS = 60000

/** 分钟 → 实际毫秒（带调试加速与下限保护）。 */
export function scaledMs(cfg, minutes) {
  const scale = Number.isFinite(cfg?.timeScale) && cfg.timeScale > 0 ? cfg.timeScale : 1
  return Math.max(1000, Math.round(minutes * MINUTE_MS * scale))
}

/** 新建一次"工作会话"。 */
export function createState(now, cfg) {
  return {
    phase: 'focus',
    sessionStartedAt: now,
    phaseStartedAt: now,
    phaseEndsAt: now + scaledMs(cfg, cfg.focusMinutes),
    focusRounds: 0, // 已跑完的专注轮数
    breakOpportunities: 0, // 提醒弹窗次数（= 每轮专注结束时 +1）
    breaksTaken: 0, // 成功中断久坐次数（休息跑完或提前点【休息好了】）
    snoozeCount: 0, // 本休息周期内"再等会"次数
    snoozeTotal: 0, // 本次会话"再等会"总数
    overSnooze: 0, // 超出 maxSnooze 的次数
    missedBreaks: 0, // 记为未中断的次数
    snoozeUntil: 0,
    stoppedAt: null,
    summary: null,
    updatedAt: now,
  }
}

/** 每秒推进：到点自动换阶段。返回 {state, changed}。 */
export function tick(state, now, cfg) {
  let s = state
  let changed = false
  if (s.phase === 'focus' && now >= s.phaseEndsAt) {
    // 专注跑完：弹窗时刻 = 休息起点
    s = {
      ...s,
      phase: 'break',
      phaseStartedAt: s.phaseEndsAt,
      phaseEndsAt: s.phaseEndsAt + scaledMs(cfg, cfg.breakMinutes),
      focusRounds: s.focusRounds + 1,
      breakOpportunities: s.breakOpportunities + 1,
      snoozeCount: 0,
      snoozeUntil: 0,
    }
    changed = true
  }
  if (s.phase === 'break' && now >= s.phaseEndsAt) {
    // 休息计时跑完：算一次成功中断，进入"回来干活"等待确认。
    // 清掉 snooze：新阶段必须立刻提醒，不能被上一阶段的"再等会"拖着。
    s = {
      ...s,
      phase: 'awaitReturn',
      phaseStartedAt: s.phaseEndsAt,
      phaseEndsAt: 0,
      breaksTaken: s.breaksTaken + 1,
      snoozeUntil: 0,
      snoozeCount: 0,
    }
    changed = true
  }
  if (
    s.phase === 'awaitReturn'
    && cfg.awaitReturnTimeoutMinutes > 0
    && now - s.phaseStartedAt >= scaledMs(cfg, cfg.awaitReturnTimeoutMinutes)
  ) {
    // 兜底：用户离开电脑一直没点确认 → 自动开下一轮，避免流程永久卡死
    s = {
      ...s,
      phase: 'focus',
      phaseStartedAt: now,
      phaseEndsAt: now + scaledMs(cfg, cfg.focusMinutes),
      snoozeUntil: 0,
      snoozeCount: 0,
      autoResumed: (s.autoResumed ?? 0) + 1,
    }
    changed = true
  }
  if (changed) s.updatedAt = now
  return { state: s, changed }
}

/**
 * 用户动作。返回 {state, ok, reason?, early?, over?, summary?}。
 * action: 'rest-done' | 'work-start' | 'snooze' | 'finish' | 'start'
 */
export function choose(state, action, cfg, now) {
  const s = state
  if (action === 'start') return { state: createState(now, cfg), ok: true }
  if (s.phase === 'stopped') return { state: s, ok: false, reason: 'stopped' }

  if (action === 'rest-done' || action === 'work-start') {
    if (s.phase !== 'break' && s.phase !== 'awaitReturn') {
      return { state: s, ok: false, reason: 'phase' }
    }
    const early = s.phase === 'break' // 休息没跑完就点，属于提前结束
    return {
      state: {
        ...s,
        phase: 'focus',
        phaseStartedAt: now,
        phaseEndsAt: now + scaledMs(cfg, cfg.focusMinutes),
        breaksTaken: s.breaksTaken + (early ? 1 : 0),
        snoozeCount: 0,
        snoozeUntil: 0,
        updatedAt: now,
      },
      ok: true,
      early,
    }
  }

  if (action === 'snooze') {
    if (s.phase !== 'break' && s.phase !== 'awaitReturn') {
      return { state: s, ok: false, reason: 'phase' }
    }
    const count = s.snoozeCount + 1
    const over = count > cfg.maxSnooze
    return {
      state: {
        ...s,
        snoozeCount: count,
        snoozeTotal: s.snoozeTotal + 1,
        overSnooze: s.overSnooze + (over ? 1 : 0),
        missedBreaks: s.missedBreaks + (over ? 1 : 0),
        snoozeUntil: now + scaledMs(cfg, cfg.snoozeMinutes),
        updatedAt: now,
      },
      ok: true,
      over,
    }
  }

  if (action === 'resume') {
    // 案例看完了/主动收回"再等会"：立刻恢复提醒（不计入暂缓次数）
    if (s.phase !== 'break' && s.phase !== 'awaitReturn') {
      return { state: s, ok: false, reason: 'phase' }
    }
    return { state: { ...s, snoozeUntil: 0, updatedAt: now }, ok: true }
  }

  if (action === 'finish') {
    const summary = summarize(s, cfg, now)
    return {
      state: { ...s, phase: 'stopped', stoppedAt: now, phaseEndsAt: 0, snoozeUntil: 0, summary, updatedAt: now },
      ok: true,
      summary,
    }
  }

  return { state: s, ok: false, reason: 'unknown-action' }
}

const COMMENTS = {
  good: '这轮节奏很稳：该起身就起身了。猫猫给你比个心～',
  mid: '有中断，但还不够干脆；下一轮试试一响就起身，哪怕只走两分钟。',
  bad: '基本没离开座位。久坐这笔账是身体在记，下一轮从站起来喝口水开始吧。',
}

/** 结算：本次工作了多久、中断几次、建议喝几次水、好中差。 */
export function summarize(state, cfg, now) {
  const opportunities = state.breakOpportunities
  const ratio = opportunities > 0 ? state.breaksTaken / opportunities : 0
  const summary = {
    startedAt: state.sessionStartedAt,
    endedAt: now,
    workMs: Math.max(0, now - state.sessionStartedAt),
    focusMinutes: cfg.focusMinutes,
    breakMinutes: cfg.breakMinutes,
    focusRounds: state.focusRounds,
    breaksTaken: state.breaksTaken,
    breakOpportunities: opportunities,
    snoozeTotal: state.snoozeTotal,
    overSnooze: state.overSnooze,
    missedBreaks: state.missedBreaks,
    suggestedDrinks: state.focusRounds, // 用户口径：不记实际喝水，用周期数代替
    hitRatio: Number(ratio.toFixed(2)),
    grade: 'bad',
    comment: '',
  }
  summary.grade = evaluate(summary, cfg)
  summary.comment = COMMENTS[summary.grade]
  return summary
}

/** 评价规则：命中率达标且没有超限暂缓 → 好；命中率过半 → 中；其余 → 差。 */
export function evaluate(summary, cfg) {
  const r = summary.hitRatio
  if (summary.focusRounds >= 1 && r >= cfg.goodRatio && summary.overSnooze === 0) return 'good'
  if (r >= cfg.midRatio) return 'mid'
  return 'bad'
}

/** 给浏览器看的快照（绝对时间戳，客户端可本地算倒计时）。 */
export function snapshot(state, cfg, now, extra = {}) {
  const remainingMs = state.phase === 'focus' || state.phase === 'break'
    ? Math.max(0, state.phaseEndsAt - now)
    : 0
  return {
    phase: state.phase,
    now,
    address: cfg.address,
    focusMinutes: cfg.focusMinutes,
    breakMinutes: cfg.breakMinutes,
    snoozeMinutes: cfg.snoozeMinutes,
    maxSnooze: cfg.maxSnooze,
    earlyBreakGuard: cfg.earlyBreakGuard,
    showFloatingPet: cfg.showFloatingPet,
    timeScale: cfg.timeScale,
    sessionStartedAt: state.sessionStartedAt,
    phaseStartedAt: state.phaseStartedAt,
    phaseEndsAt: state.phaseEndsAt,
    remainingMs,
    elapsedMs: Math.max(0, now - state.phaseStartedAt),
    sessionMs: Math.max(0, now - state.sessionStartedAt),
    focusRounds: state.focusRounds,
    breaksTaken: state.breaksTaken,
    breakOpportunities: state.breakOpportunities,
    snoozeCount: state.snoozeCount,
    snoozeTotal: state.snoozeTotal,
    overSnooze: state.overSnooze,
    missedBreaks: state.missedBreaks,
    snoozeUntil: state.snoozeUntil,
    summary: state.summary,
    ...extra,
  }
}
