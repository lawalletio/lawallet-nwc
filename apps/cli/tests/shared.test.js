import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createComposeProjectName,
  createDatabaseName,
  createDatabaseUser,
  createInstanceId,
  deriveRepoDirectoryName
} from '../src/lib/shared.js'

test('deriveRepoDirectoryName handles git urls and local paths', () => {
  assert.equal(
    deriveRepoDirectoryName('https://github.com/lawalletio/lawallet-nwc.git'),
    'lawallet-nwc'
  )
  assert.equal(
    deriveRepoDirectoryName('/tmp/some/path/lawallet-nwc'),
    'lawallet-nwc'
  )
})

test('createInstanceId is deterministic and bounded', () => {
  const first = createInstanceId('/tmp/lawallet-nwc')
  const second = createInstanceId('/tmp/lawallet-nwc')

  assert.equal(first, second)
  assert.ok(first.length <= 32)
})

test('database and compose names stay within postgres limits', () => {
  const instanceId = 'very_long_instance_name_for_testing_123456'

  assert.ok(createDatabaseName(instanceId).length <= 63)
  assert.ok(createDatabaseUser(instanceId).length <= 63)
  assert.ok(createComposeProjectName(instanceId).length <= 63)
})
