// 运行期状态持久化：<DSH_HOME>/data/dsh-no-long-sit/*.json
//
// 为什么不用 storageDomain：本插件走本地开发（link: 安装），要尽量避免额外依赖
// （storageDomain 的 schema 需要 zod 可解析）；whale-girl 也是同样的文件落盘做法。
// 韧性命中面：同目录 .tmp + rename 原子替换 + 有限重试 + 失败不阻塞插件。
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const PLUGIN_DIR_NAME = 'dsh-no-long-sit'

/** DSH home：优先环境变量（宿主注入），回落到 ~/.dsh。 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return typeof fromEnv === 'string' && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
}

/** 插件数据目录（绝不写进插件安装目录——卸载会连带删除）。 */
export function dataDir() {
  return join(dshHome(), 'data', PLUGIN_DIR_NAME)
}

export const statePath = () => join(dataDir(), 'state.json')
export const casesCachePath = () => join(dataDir(), 'cases-cache.json')
export const logPath = () => join(dataDir(), 'log.jsonl')

/** 读 JSON；缺失/损坏返回 fallback，绝不抛。 */
export function loadJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写 JSON：tmp → rename，失败重试 3 次（短暂占用场景）。 */
export function saveJsonAtomic(file, value) {
  const text = JSON.stringify(value)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(tmp, text, 'utf8')
      renameSync(tmp, file)
      return true
    } catch (error) {
      lastError = error
      try {
        unlinkSync(tmp)
      } catch {
        /* tmp 不存在也无所谓 */
      }
    }
  }
  return false
}

/** 追加一行事件日志（失败静默：日志不该拖垮插件）。 */
export function appendLog(entry) {
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(logPath(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { flag: 'a' })
  } catch {
    /* ignore */
  }
}
