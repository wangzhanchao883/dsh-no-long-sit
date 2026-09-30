// 配置层：schemastery schema + 默认值单一来源（零宿主依赖，可单测）。
//
// 硬契约（DSH 0.1.7 / 0.2.0-rc.2 实测）：
// - 想让设置页能读写的字段**必须** .volatile()：非 volatile 字段不进表单投影，
//   写入直接抛 `Config field "..." is not volatile`。
// - schema 只负责校验 / 默认值 / 白名单，**不负责渲染控件**：设置卡片由 client.js 自绘。
// - 命名空间 = profile 行 id（cordis.patch.yml 里的 insert[].id）= 'dsh-no-long-sit'。
import z from '@deepseek-ai/schemastery'

/** settings 命名空间 / profile 行 id 单一来源。 */
export const NS = 'dsh-no-long-sit'

/** 只在支持时打 volatile（不同 schemastery 小版本 API 可能缺席）。 */
const vol = (schema) => (typeof schema?.volatile === 'function' ? schema.volatile() : schema)

/** 体验层默认值（消费端唯一权威，别在别处再写第二份字面量）。 */
export const DEFAULTS = Object.freeze({
  enabled: true, // 总开关
  address: '大人', // 猫猫对用户的称呼（宿主没有统一"用户称呼"字段，由插件自己持有）
  focusMinutes: 30, // 专注周期（30–90）
  breakMinutes: 5, // 休息周期（3–15）
  snoozeMinutes: 5, // 点【再等会】后多久重新提醒
  maxSnooze: 2, // 每个休息周期最多允许"再等会"几次，超出记一次未中断
  earlyBreakGuard: true, // 休息没到点就点【休息好了】时，软提示一次
  soundEnabled: true, // 到点播放"滴滴滴"提示音
  soundVolume: 0.6, // 提示音音量 0–1
  awaitReturnTimeoutMinutes: 10, // 「回来干活」最多等多久，超时自动开下一轮（0 = 不自动）
  goodRatio: 0.8, // 评价"好"所需的中断命中率
  midRatio: 0.5, // 评价"中"所需的中断命中率
  caseRefreshEnabled: true, // 启动后后台刷新案例库
  caseRefreshDelayMinutes: 10, // 启动后多久触发刷新
  showFloatingPet: true, // 右下角常驻猫猫
  petOpacity: 0.75, // 桌宠不透明度（0.2–1；1 = 完全不透明）
  timeScale: 1, // 仅调试：把分钟压成秒（0.01 = 30 分钟变 18 秒）
})

/** schemastery schema（settings.register 用；默认值与 DEFAULTS 同源，防双写漂移）。 */
export function buildSchema() {
  return z.object({
    enabled: vol(z.boolean().default(DEFAULTS.enabled)),
    address: vol(z.string().default(DEFAULTS.address)),
    focusMinutes: vol(z.natural().min(30).max(90).default(DEFAULTS.focusMinutes)),
    breakMinutes: vol(z.natural().min(3).max(15).default(DEFAULTS.breakMinutes)),
    snoozeMinutes: vol(z.natural().min(1).max(15).default(DEFAULTS.snoozeMinutes)),
    maxSnooze: vol(z.natural().min(0).max(5).default(DEFAULTS.maxSnooze)),
    earlyBreakGuard: vol(z.boolean().default(DEFAULTS.earlyBreakGuard)),
    soundEnabled: vol(z.boolean().default(DEFAULTS.soundEnabled)),
    soundVolume: vol(z.number().min(0).max(1).step(0.05).default(DEFAULTS.soundVolume)),
    awaitReturnTimeoutMinutes: vol(z.natural().min(0).max(60).default(DEFAULTS.awaitReturnTimeoutMinutes)),
    goodRatio: vol(z.number().min(0.5).max(1).step(0.05).default(DEFAULTS.goodRatio)),
    midRatio: vol(z.number().min(0).max(0.9).step(0.05).default(DEFAULTS.midRatio)),
    caseRefreshEnabled: vol(z.boolean().default(DEFAULTS.caseRefreshEnabled)),
    caseRefreshDelayMinutes: vol(z.natural().min(1).max(120).default(DEFAULTS.caseRefreshDelayMinutes)),
    showFloatingPet: vol(z.boolean().default(DEFAULTS.showFloatingPet)),
    petOpacity: vol(z.number().min(0.2).max(1).step(0.05).default(DEFAULTS.petOpacity)),
    timeScale: vol(z.number().min(0.001).max(1).step(0.001).default(DEFAULTS.timeScale)),
  })
}

/** 跨字段校验（schema 表达不了的成对约束）。 */
export function validateConfig(value) {
  if (!value || typeof value !== 'object') return
  if (Number(value.midRatio) >= Number(value.goodRatio)) {
    throw new Error('midRatio（中）必须小于 goodRatio（好）')
  }
}

/** 把任意来源（settings scope / 行 config / 默认值）收敛成完整可用配置。 */
export function normalizeConfig(raw) {
  const v = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  const int = (x, lo, hi, d) => {
    const n = Number(x)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d
  }
  const num = (x, lo, hi, d) => {
    const n = Number(x)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
  }
  const address = typeof v.address === 'string' && v.address.trim().length > 0
    ? v.address.trim().slice(0, 24)
    : DEFAULTS.address
  const goodRatio = num(v.goodRatio, 0.5, 1, DEFAULTS.goodRatio)
  let midRatio = num(v.midRatio, 0, 0.9, DEFAULTS.midRatio)
  if (midRatio >= goodRatio) midRatio = Math.max(0, Number((goodRatio - 0.05).toFixed(2)))
  return {
    enabled: v.enabled !== false,
    address,
    focusMinutes: int(v.focusMinutes, 30, 90, DEFAULTS.focusMinutes),
    breakMinutes: int(v.breakMinutes, 3, 15, DEFAULTS.breakMinutes),
    snoozeMinutes: int(v.snoozeMinutes, 1, 15, DEFAULTS.snoozeMinutes),
    maxSnooze: int(v.maxSnooze, 0, 5, DEFAULTS.maxSnooze),
    earlyBreakGuard: v.earlyBreakGuard !== false,
    soundEnabled: v.soundEnabled !== false,
    soundVolume: num(v.soundVolume, 0, 1, DEFAULTS.soundVolume),
    awaitReturnTimeoutMinutes: int(v.awaitReturnTimeoutMinutes, 0, 60, DEFAULTS.awaitReturnTimeoutMinutes),
    goodRatio,
    midRatio,
    caseRefreshEnabled: v.caseRefreshEnabled !== false,
    caseRefreshDelayMinutes: int(v.caseRefreshDelayMinutes, 1, 120, DEFAULTS.caseRefreshDelayMinutes),
    showFloatingPet: v.showFloatingPet !== false,
    petOpacity: num(v.petOpacity, 0.2, 1, DEFAULTS.petOpacity),
    timeScale: num(v.timeScale, 0.001, 1, DEFAULTS.timeScale),
  }
}
