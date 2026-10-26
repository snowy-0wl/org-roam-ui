const assert = require('assert').strict
const fs = require('fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  })
  module._compile(outputText, filename)
}
const { deleteNodeInEmacs } = require('../util/webSocketFunctions.ts')
const messages = []
const socket = { send: text => messages.push(JSON.parse(text)) }
deleteNodeInEmacs({ id: 'heading', file: '/notes.org', level: 1 }, socket)
assert.deepEqual(messages, [])
deleteNodeInEmacs({ id: 'note', file: '/notes.org', level: 0 }, socket)
assert.deepEqual(messages, [{ command: 'delete', data: { id: 'note' } }])
