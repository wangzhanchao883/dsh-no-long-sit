// 路由工具单测：跨源拦截、动作白名单、素材白名单。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCrossOrigin, parseAction, artFileFor, artContentType, ACTIONS, FALLBACK_PET_SVG,
  sanitizeAssetRel, assetContentType,
} from '../lib/routes.mjs'

test('同源请求放行；跨源请求拦截', () => {
  assert.equal(isCrossOrigin({ headers: { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:19387' } }), false)
  assert.equal(isCrossOrigin({ headers: { 'sec-fetch-site': 'cross-site' } }), true)
  assert.equal(isCrossOrigin({ headers: { origin: 'https://evil.example', host: '127.0.0.1:19387' } }), true)
  assert.equal(isCrossOrigin({ headers: { origin: 'http://127.0.0.1:19387', host: '127.0.0.1:19387' } }), false)
  // 无任何头的直连（curl / 健康检查）放行
  assert.equal(isCrossOrigin({ headers: {} }), false)
})

test('动作白名单：只有约定的 5 个动作能过', () => {
  for (const action of ACTIONS) assert.equal(parseAction(JSON.stringify({ action })), action)
  assert.equal(parseAction(JSON.stringify({ action: 'drop-table' })), null)
  assert.equal(parseAction(''), null)
  assert.equal(parseAction('not json'), null)
  assert.equal(parseAction(JSON.stringify({ action: 'finish', extra: 1 })), 'finish')
})

test('素材白名单：只允许 4 个状态动图 + manifest，杜绝路径穿越', () => {
  assert.equal(artFileFor('idle'), 'anim/idle.webp')
  assert.equal(artFileFor('sleep'), 'anim/sleep.webp')
  assert.equal(artFileFor('../../package.json'), null)
  assert.equal(artFileFor('..\\..\\index.mjs'), null)
  assert.equal(artFileFor('unknown'), null)
  assert.match(artContentType('idle'), /^image\/webp/)
  assert.match(artContentType('manifest'), /^application\/json/)
})

test('动作白名单包含 resume（案例看完立刻恢复提醒）', () => {
  assert.equal(ACTIONS.includes('resume'), true)
  assert.equal(parseAction(JSON.stringify({ action: 'resume' })), 'resume')
})

test('素材相对路径净化：只放行白名单扩展名，杜绝穿越', () => {
  // 放行
  assert.equal(sanitizeAssetRel('anim/idle.webp'), 'anim/idle.webp')
  assert.equal(sanitizeAssetRel('pet-manifest.json'), 'pet-manifest.json')
  assert.equal(sanitizeAssetRel('frames/idle/idle-01.png'), 'frames/idle/idle-01.png')
  assert.equal(sanitizeAssetRel('anim/rise.webp'), 'anim/rise.webp')
  assert.equal(sanitizeAssetRel('anim\\idle.gif'), 'anim/idle.gif')
  // 拒绝
  for (const bad of [
    '../package.json', 'frames/../../index.mjs', '/etc/passwd', './x.png', 'a//b.png',
    'evil.exe', 'noext', '', null, 42, 'frames/idle/idle-01.png\u0000', 'x'.repeat(300) + '.png',
  ]) {
    assert.equal(sanitizeAssetRel(bad), null, `应拒绝：${String(bad)}`)
  }
})

test('素材 content-type 按扩展名判定', () => {
  assert.match(assetContentType('a.svg'), /^image\/svg\+xml/)
  assert.equal(assetContentType('frames/idle/idle-01.png'), 'image/png')
  assert.equal(assetContentType('anim/rise.webp'), 'image/webp')
  assert.equal(assetContentType('anim/idle.gif'), 'image/gif')
  assert.match(assetContentType('pet-manifest.json'), /^application\/json/)
  assert.equal(assetContentType('x.bin'), 'application/octet-stream')
})

test('兜底猫猫 SVG 非空且是 svg', () => {
  assert.match(FALLBACK_PET_SVG, /^<svg /)
  assert.match(FALLBACK_PET_SVG, /<\/svg>$/)
})
