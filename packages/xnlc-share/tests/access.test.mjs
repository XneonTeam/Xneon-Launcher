import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectShareAccount } from '../lib/index.js'

test('Share недоступен без аккаунтов и с одними offline', () => {
  assert.equal(selectShareAccount([]), undefined)
  assert.equal(selectShareAccount([{ type: 'offline', username: 'Player', isActive: true }]), undefined)
})
test('Подходит любой тип кроме offline, даже если активный аккаунт offline', () => {
  for (const type of ['microsoft', 'elyby', 'xnskins', 'authlib-injector', 'custom-provider']) {
    const online = { type, username: 'Online', isActive: false }
    assert.equal(selectShareAccount([{ type: 'offline', username: 'Player', isActive: true }, online]), online)
  }
})
test('Активный не-offline используется для имени; его наличие не обязательно', () => {
  const first = { type: 'elyby', username: 'First' }, active = { type: 'xnskins', username: 'Active', isActive: true }
  assert.equal(selectShareAccount([first, active]), active)
  assert.equal(selectShareAccount([first]), first)
})
