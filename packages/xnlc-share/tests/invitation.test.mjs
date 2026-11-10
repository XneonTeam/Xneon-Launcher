import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInvitation } from '../lib/index.js'

test('код приглашения: нормализация ввода и совместимость с ранее выданными приглашениями', () => {
  const code = 'XNLC-ABCD-EFGH-JKLM-NPQR-STUV'
  assert.equal(parseInvitation(code), code)
  assert.equal(parseInvitation('  xnlc-abcd-efgh- jklm-npqr-stuv\n'), code)
  const legacy = 'aBcDeFgHiJkLmNoPqRsTuV0123456789_abc'
  assert.equal(parseInvitation(legacy), legacy)
  for (const invalid of ['', 'XNLC-short', 'XNLC-ABCD-EFGH-IOLM-NPQR-STUV', `https://example.com/invite/${legacy}`, `xneon://share/invite/${legacy}`]) {
    assert.throws(() => parseInvitation(invalid), { code: 'INVITE' })
  }
})
