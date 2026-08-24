import { describe } from 'noba'
import * as uuid from 'uuid' with { imports: 'bare-node-runtime/imports' }

/**
 * Bare compatibility probe for uuid.
 *
 * The transport calls `v4()` once, to mint a device id when a connection has none. Unlike
 * purify-ts and rxjs, this one does not just work: uuid@11 ships separate node and browser
 * builds, Bare matches the node condition, and that build's rng.js imports a bare `crypto`
 * specifier that Bare cannot resolve.
 *
 * Bare's import map fixes it, applied as an import attribute at the top of this file. That
 * attribute is Bare only, since Node rejects it with ERR_IMPORT_ATTRIBUTE_UNSUPPORTED, which
 * is fine here because the suite runs on Bare alone (`npm test` runs `noba-bare`).
 *
 * One ordering rule worth knowing: a failed plain `import('uuid')` poisons Bare's module
 * cache for that graph, and every later mapped import of it fails too. The mapped import at
 * the top of this file runs first, so the cache holds the working copy.
 */
describe('uuid: module loading', ({ test }) => {
  test('the mapped import loads with all 14 exports', ({ assert }) => {
    assert.equal(Object.keys(uuid).length, 14)
    assert.equal(typeof uuid.v4, 'function')
  })

  test('the mapped copy satisfies later plain imports too', async ({ assert }) => {
    const plain = await import('uuid')
    assert.equal(typeof plain.v4, 'function')
    assert.isTrue(plain.validate(plain.v4()))
  })

  test('@tetherto/uuid resolves to the same thing, as src imports it', async ({
    assert,
  }) => {
    const wrapper = await import('@tetherto/uuid')
    assert.equal(typeof wrapper.v4, 'function')
    assert.isTrue(uuid.validate(wrapper.v4()))
  })
})

describe('uuid: random ids', ({ test }) => {
  test('v4 produces a valid, version 4, unique id', async ({ assert }) => {
    const { v4, validate, version } = uuid
    const id = v4()
    assert.isTrue(validate(id))
    assert.equal(version(id), 4)
    assert.notEqual(v4(), v4())
  })

  test('v7 is time ordered and valid', async ({ assert }) => {
    const { v7, validate, version } = uuid
    const first = v7()
    const second = v7()
    assert.isTrue(validate(first))
    assert.equal(version(first), 7)
    assert.isTrue(first <= second)
  })

  test('v1 and v6 convert both ways', async ({ assert }) => {
    const { v1, v6, v1ToV6, v6ToV1, version } = uuid
    const one = v1()
    assert.equal(version(one), 1)
    assert.equal(version(v1ToV6(one)), 6)
    assert.equal(version(v6ToV1(v6())), 1)
  })
})

describe('uuid: name based ids', ({ test }) => {
  test('v3 and v5 hash deterministically, so bare-crypto covers md5 and sha1', async ({
    assert,
  }) => {
    const { v3, v5, NIL, version } = uuid
    assert.equal(v5('ledger', NIL), v5('ledger', NIL))
    assert.equal(version(v5('ledger', NIL)), 5)
    assert.equal(v3('ledger', NIL), v3('ledger', NIL))
    assert.equal(version(v3('ledger', NIL)), 3)
    assert.notEqual(v5('ledger', NIL), v5('nano-x', NIL))
  })
})

describe('uuid: helpers and constants', ({ test }) => {
  test('parse and stringify round trip', async ({ assert }) => {
    const { parse, stringify, v4 } = uuid
    const id = v4()
    const bytes = parse(id)
    assert.equal(bytes.length, 16)
    assert.equal(stringify(bytes), id)
  })

  test('validate rejects malformed input', async ({ assert }) => {
    const { validate } = uuid
    assert.isFalse(validate('not-a-uuid'))
    assert.isFalse(validate(''))
  })

  test('NIL and MAX are the documented constants', async ({ assert }) => {
    const { NIL, MAX, validate } = uuid
    assert.equal(NIL, '00000000-0000-0000-0000-000000000000')
    assert.equal(MAX, 'ffffffff-ffff-ffff-ffff-ffffffffffff')
    assert.isTrue(validate(NIL))
  })

  test('every export is exercised', async ({ assert }) => {
    
    const covered = [
      'MAX', 'NIL', 'parse', 'stringify', 'v1', 'v1ToV6', 'v3', 'v4', 'v5',
      'v6', 'v6ToV1', 'v7', 'validate', 'version',
    ].sort()
    assert.deepEqual(Object.keys(uuid).sort(), covered)
  })
})

describe('uuid: bare-crypto as the alternative', ({ test }) => {
  test('randomUUID covers the only call the transport makes', async ({ assert }) => {
    const { default: crypto } = await import('bare-crypto')
    const { validate, version } = uuid
    const id = crypto.randomUUID()
    assert.isTrue(validate(id))
    assert.equal(version(id), 4)
    assert.notEqual(crypto.randomUUID(), crypto.randomUUID())
  })
})
