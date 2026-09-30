// 案例库单测：形状校验、去重合并、防编造过滤、内置库健康度。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isValidCase, loadBuiltin, mergeCases, filterRefreshed } from '../lib/cases.mjs'

const good = {
  kind: 'sit',
  title: '示例案例',
  fact: '这是一条用于测试的示例事实描述，长度足够通过校验。',
  url: 'https://example.com/a',
  source: '示例来源',
  publishedAt: '2026-01-01',
}

test('形状校验：字段类型与 url 协议必须合规', () => {
  assert.equal(isValidCase(good), true)
  assert.equal(isValidCase({ ...good, kind: 'other' }), false)
  assert.equal(isValidCase({ ...good, url: 'ftp://example.com' }), false)
  assert.equal(isValidCase({ ...good, title: '  ' }), false)
  assert.equal(isValidCase({ ...good, fact: '太短' }), false)
  assert.equal(isValidCase(null), false)
})

test('合并：按 url 去重，刷新结果优先于内置', () => {
  const builtin = [good, { ...good, url: 'https://example.com/b', title: '内置B' }]
  const refreshed = [{ ...good, title: '刷新A' }]
  const merged = mergeCases(builtin, refreshed)
  assert.equal(merged.length, 2)
  assert.equal(merged.find((c) => c.url === good.url).title, '刷新A')
  assert.equal(merged.find((c) => c.url === good.url).origin, 'refresh')
  assert.equal(merged.find((c) => c.url === 'https://example.com/b').origin, 'builtin')
})

test('防编造：url 不在检索来源白名单里的条目一律丢弃', () => {
  const sources = [{ url: 'https://news.example.com/real' }]
  const items = [
    { ...good, url: 'https://news.example.com/real', title: '真实' },
    { ...good, url: 'https://made-up.example.com/x', title: '编造' },
  ]
  const kept = filterRefreshed(items, sources)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].title, '真实')
  assert.equal(filterRefreshed(items, []).length, 0)
})

test('内置案例库随包分发且每条都合规', () => {
  const file = join(import.meta.dirname, '..', 'assets', 'cases.json')
  assert.equal(existsSync(file), true, 'assets/cases.json 必须随包分发')
  const builtin = loadBuiltin()
  assert.ok(builtin.cases.length >= 8, `内置案例过少：${builtin.cases.length}`)
  for (const item of builtin.cases) assert.equal(isValidCase(item), true, `非法案例：${item && item.title}`)
  const kinds = new Set(builtin.cases.map((c) => c.kind))
  assert.equal(kinds.has('sit'), true)
  assert.equal(kinds.has('water'), true)
})
