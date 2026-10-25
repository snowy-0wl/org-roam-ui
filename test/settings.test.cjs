const assert = require('assert').strict
const fs = require('fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  })
  module._compile(outputText, filename)
}
const { collectSettings, applySettings, getDefaultSettings, createSettingsClient } = require('../util/settings-manager.ts')

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)) }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}
const document = (preferences) => ({ version: 1, preferences })

async function main() {
  const storage = new MemoryStorage({
    '3d': 'false', showTweaks: 'false',
    physics: JSON.stringify({ enabled: false, charge: -42 }),
    filter: JSON.stringify({ nodes: ['private-note'], tagsWhitelist: ['study'] }),
    unrelated: 'keep this value',
  })
  const snapshot = collectSettings(storage)
  assert.equal(snapshot.preferences['3d'], false)
  assert.equal(snapshot.preferences.physics.charge, -42)
  assert.equal(snapshot.preferences.physics.enabled, false)
  assert.equal(snapshot.preferences.showTweaks, false)
  assert.equal('nodes' in snapshot.preferences.filter, false)
  assert.equal('unrelated' in snapshot.preferences, false)
  let updates = 0
  applySettings(snapshot, storage, () => updates++)
  assert.deepEqual(collectSettings(storage), snapshot)
  assert.equal(updates, 1)
  assert.equal(storage.getItem('unrelated'), 'keep this value')

  storage.setItem('physics', JSON.stringify({ charge: 999 }))
  applySettings(document({ '3d': false }), storage, () => updates++)
  assert.equal(JSON.parse(storage.getItem('physics')).charge, getDefaultSettings().preferences.physics.charge)
  const before = new Map(storage.values)
  assert.throws(() => applySettings(document({ '3d': 'bad' }), storage, () => updates++), /Invalid settings/)
  assert.deepEqual(storage.values, before)
  assert.throws(() => applySettings(document({ graph: ['private-note'] }), storage, () => updates++))

  const originalSet = storage.setItem.bind(storage)
  let failOnce = true
  storage.setItem = (key, value) => {
    if (key === 'physics' && failOnce) { failOnce = false; throw new Error('Storage quota') }
    originalSet(key, value)
  }
  assert.throws(() => applySettings(document({ '3d': true }), storage, () => updates++), /Storage quota/)
  assert.deepEqual(storage.values, before)
  storage.setItem = originalSet

  const sent = []
  const socket = { readyState: 1, send: (text) => sent.push(JSON.parse(text)) }
  const errors = []
  const client = createSettingsClient(socket, storage, () => updates++, { timeout: 5, onError: (message) => errors.push(message) })
  client.ready()
  assert.equal(sent.at(-1).data.loadSaved, true)
  client.ready()
  assert.equal(sent.at(-1).data.loadSaved, false)

  const saved = client.save()
  const save = sent.at(-1)
  assert.equal(save.command, 'settings-save')
  assert.equal(save.data.settings.preferences['3d'], false)
  client.handleMessage({ type: 'settings-result', data: { requestId: save.data.requestId, ok: true, message: 'Saved' } })
  assert.equal(await saved, 'Saved')

  const restored = client.restore()
  const restore = sent.at(-1)
  client.handleMessage({ type: 'settings-apply', data: { requestId: restore.data.requestId, settings: document({ '3d': true, showTweaks: false }) } })
  assert.equal(sent.at(-1).command, 'settings-applied')
  assert.equal(sent.at(-1).data.ok, true)
  assert.equal(JSON.parse(storage.getItem('3d')), true)
  client.handleMessage({ type: 'settings-result', data: { requestId: restore.data.requestId, ok: true } })
  await restored

  const malformedBefore = new Map(storage.values)
  client.handleMessage({ type: 'settings-apply', data: { requestId: 'invalid', settings: document({ '3d': 'bad' }) } })
  assert.equal(sent.at(-1).data.ok, false)
  assert.deepEqual(storage.values, malformedBefore)
  client.handleMessage({ type: 'settings-result', data: { requestId: 'auto-load', ok: false, error: 'Saved file is invalid' } })
  assert.deepEqual(errors, ['Saved file is invalid'])

  const timedOut = client.save()
  await assert.rejects(timedOut, /did not acknowledge/)
  const disconnected = client.restore()
  client.disconnect()
  await assert.rejects(disconnected, /disconnected/)
  socket.readyState = 3
  await assert.rejects(client.save(), /disconnected/)
  console.log('Settings round-trip, validation, rollback, load-once, acknowledgments and disconnect checks passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
