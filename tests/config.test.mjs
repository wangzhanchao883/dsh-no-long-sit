// 配置层单测：默认值、范围收敛、跨字段校验。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, NS, buildSchema, normalizeConfig, validateConfig } from '../lib/config.mjs'

test('默认值符合产品口径：专注 30 / 休息 5 / 称呼「大人」', () => {
  assert.equal(NS, 'dsh-no-long-sit')
  assert.equal(DEFAULTS.focusMinutes, 30)
  assert.equal(DEFAULTS.breakMinutes, 5)
  assert.equal(DEFAULTS.address, '大人')
  assert.equal(DEFAULTS.timeScale, 1)
})

test('范围收敛：越界输入被夹到合法区间', () => {
  const c = normalizeConfig({ focusMinutes: 999, breakMinutes: 0, snoozeMinutes: -3, maxSnooze: 99, timeScale: 5 })
  assert.equal(c.focusMinutes, 90)
  assert.equal(c.breakMinutes, 3)
  assert.equal(c.snoozeMinutes, 1)
  assert.equal(c.maxSnooze, 5)
  assert.equal(c.timeScale, 1)
})

test('脏输入不炸：null / 字符串 / NaN 一律回落默认值', () => {
  for (const bad of [null, undefined, 'x', 42, { focusMinutes: 'abc', address: '   ' }]) {
    const c = normalizeConfig(bad)
    assert.equal(c.focusMinutes, 30)
    assert.equal(c.address, '大人')
    assert.equal(c.breakMinutes, 5)
  }
})

test('称呼裁剪：去空格、截断到 24 字', () => {
  assert.equal(normalizeConfig({ address: '  老板  ' }).address, '老板')
  assert.equal(normalizeConfig({ address: 'x'.repeat(99) }).address.length, 24)
})

test('提示音与等待上限的默认值与收敛', () => {
  assert.equal(DEFAULTS.soundEnabled, true)
  assert.equal(DEFAULTS.soundVolume, 0.6)
  assert.equal(DEFAULTS.awaitReturnTimeoutMinutes, 10)
  const c = normalizeConfig({ soundVolume: 5, awaitReturnTimeoutMinutes: 999, soundEnabled: false })
  assert.equal(c.soundVolume, 1)
  assert.equal(c.awaitReturnTimeoutMinutes, 60)
  assert.equal(c.soundEnabled, false)
  assert.equal(normalizeConfig({ soundVolume: -1 }).soundVolume, 0)
  assert.equal(normalizeConfig({ awaitReturnTimeoutMinutes: 0 }).awaitReturnTimeoutMinutes, 0)
})

test('桌宠不透明度：默认 0.75（= 25% 透明），越界收敛到 0.2–1', () => {
  assert.equal(DEFAULTS.petOpacity, 0.75)
  assert.equal(normalizeConfig({}).petOpacity, 0.75)
  assert.equal(normalizeConfig({ petOpacity: 0 }).petOpacity, 0.2)
  assert.equal(normalizeConfig({ petOpacity: 9 }).petOpacity, 1)
  assert.equal(normalizeConfig({ petOpacity: 'x' }).petOpacity, 0.75)
  assert.equal(normalizeConfig({ petOpacity: 1 }).petOpacity, 1)
})

test('midRatio 必须小于 goodRatio（naive 输入自动纠正，validate 抛错）', () => {
  const c = normalizeConfig({ goodRatio: 0.8, midRatio: 0.9 })
  assert.equal(c.midRatio < c.goodRatio, true)
  assert.throws(() => validateConfig({ goodRatio: 0.5, midRatio: 0.5 }), /midRatio/)
  assert.doesNotThrow(() => validateConfig({ goodRatio: 0.8, midRatio: 0.5 }))
})

test('schema 的每个字段都是 volatile（否则设置页不显示、写入被拒）', () => {
  const schema = buildSchema()
  // schemastery 的 object schema 把字段放在 .dict 里
  const dict = schema.dict ?? schema
  const keys = Object.keys(DEFAULTS)
  for (const key of keys) {
    assert.ok(dict[key], `schema 缺少字段 ${key}`)
    assert.doesNotThrow(() => JSON.stringify(dict[key]))
  }
  assert.deepEqual(Object.keys(dict).sort(), keys.slice().sort())
})
