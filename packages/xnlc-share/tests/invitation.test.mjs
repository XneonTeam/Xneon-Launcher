import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInvitation } from '../lib/index.js'

test('код приглашения: нормализация ввода и совместимость с ранее выданными приглашениями', () => {
  const code = 'XNLC-ABCD-EFGH-JKLM-NPQR-STUV'
  assert.equal(parseInvitation(code), code)
  assert.equal(parseInvitation('  xnlc-abcd-efgh- jklm-npqr-stuv\n'), code)
  assert.equal(parseInvitation(`xneon://share/invite/${code}`), code)
  const legacy = 'aBcDeFgHiJkLmNoPqRsTuV0123456789_abc'
  assert.equal(parseInvitation(legacy), legacy)
  assert.equal(parseInvitation(`xneon://share/invite/${legacy}`), legacy)
  for (const invalid of ['', 'XNLC-short', 'XNLC-ABCD-EFGH-IOLM-NPQR-STUV', `https://example.com/invite/${legacy}`, `xneon://share/invite/${legacy}?x=1`]) {
    assert.throws(() => parseInvitation(invalid), { code: 'INVITE' })
  }
})
