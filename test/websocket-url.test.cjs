const assert = require('assert').strict
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../util/webSocketUrl.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
const context = { exports: {}, URLSearchParams }
vm.runInNewContext(compiled.outputText, context)
const { getWebSocketUrl } = context.exports

assert.equal(getWebSocketUrl(new URL('http://localhost:35901')), 'ws://localhost:35903')
assert.equal(
  getWebSocketUrl(new URL('http://127.0.0.1:36901?wsPort=36903')),
  'ws://127.0.0.1:36903',
)
assert.equal(getWebSocketUrl(new URL('https://example.test?wsPort=443')), 'wss://example.test:443')
console.log('Websocket URL regression checks passed')
