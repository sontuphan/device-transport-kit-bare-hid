import { describe } from 'noba'
import {
  Codec,
  Either,
  EitherAsync,
  Just,
  Left,
  List,
  Maybe,
  MaybeAsync,
  NonEmptyList,
  Nothing,
  Order,
  Right,
  Tuple,
  always,
  array,
  boolean,
  compare,
  curry,
  date,
  enumeration,
  exactly,
  identity,
  intersect,
  lazy,
  map,
  maybe,
  nonEmptyList,
  nullType,
  nullable,
  number,
  oneOf,
  optional,
  orderToNumber,
  parseError,
  record,
  string,
  tuple,
  unknown,
} from 'purify-ts'

/**
 * Bare compatibility probe for purify-ts.
 *
 * Every result the Ledger transport returns is an Either or an EitherAsync, so if this
 * library does not run under Bare, nothing downstream does. Rather than probe only the
 * surface the transport calls, this covers all 38 exports, and the coverage guard at the
 * bottom fails if an upgrade adds one the probe does not exercise.
 *
 * Runs on Bare only: `npm test` runs `noba-bare`.
 */

describe('purify-ts: module loading', ({ test }) => {
  test('resolves through the package export map', ({ assert }) => {
    assert.isExist(Either)
    assert.isExist(EitherAsync)
    assert.isExist(Maybe)
    assert.equal(typeof Left, 'function')
    assert.equal(typeof Right, 'function')
    assert.equal(typeof Just, 'function')
    assert.isExist(Nothing)
  })
})

describe('purify-ts: Either', ({ test }) => {
  test('Right carries its value', ({ assert }) => {
    const either = Right(42)
    assert.isTrue(either.isRight())
    assert.isFalse(either.isLeft())
    assert.equal(either.extract(), 42)
  })

  test('Left carries its error', ({ assert }) => {
    const either = Left(new Error('boom'))
    assert.isTrue(either.isLeft())
    assert.instanceOf(either.extract(), Error)
  })

  test('map and chain compose on Right and short circuit on Left', ({ assert }) => {
    const ok = Right(2)
      .map((n) => n * 3)
      .chain((n) => (n > 5 ? Right(n) : Left('too small')))
    assert.equal(ok.extract(), 6)

    const short = Left('boom')
      .map(() => {
        throw new Error('map ran on a Left')
      })
      .chain(() => Right('unreachable'))
    assert.equal(short.extract(), 'boom')
  })

  test('caseOf branches, as the transport uses it', ({ assert }) => {
    const branch = (either) =>
      either.caseOf({
        Left: (error) => `left:${error}`,
        Right: (value) => `right:${value}`,
      })
    assert.equal(branch(Right('device')), 'right:device')
    assert.equal(branch(Left('no device')), 'left:no device')
  })
})

describe('purify-ts: Maybe', ({ test }) => {
  test('Just and Nothing behave', ({ assert }) => {
    assert.isTrue(Just(1).isJust())
    assert.isTrue(Nothing.isNothing())
    assert.equal(Just(1).orDefault(0), 1)
    assert.equal(Nothing.orDefault(0), 0)
  })

  test('fromNullable maps null and undefined onto Nothing', ({ assert }) => {
    assert.isTrue(Maybe.fromNullable(null).isNothing())
    assert.isTrue(Maybe.fromNullable(undefined).isNothing())
    assert.isTrue(Maybe.fromNullable(0).isJust())
  })
})

describe('purify-ts: EitherAsync', ({ test }) => {
  test('run resolves to a Right', async ({ assert }) => {
    const result = await EitherAsync(async () => {
      await Promise.resolve()
      return 'connected'
    }).run()
    assert.isTrue(result.isRight())
    assert.equal(result.extract(), 'connected')
  })

  test('throwE resolves to a Left rather than rejecting', async ({ assert }) => {
    const result = await EitherAsync(async ({ throwE }) => {
      throwE('no accessible device')
      return 'unreachable'
    }).run()
    assert.isTrue(result.isLeft())
    assert.equal(result.extract(), 'no accessible device')
  })

  test('a thrown error is captured as a Left', async ({ assert }) => {
    const result = await EitherAsync(async () => {
      throw new Error('device has been closed')
    }).run()
    assert.isTrue(result.isLeft())
    assert.instanceOf(result.extract(), Error)
  })

  test('liftEither and chain thread through async work', async ({ assert }) => {
    const result = await EitherAsync(async ({ liftEither, fromPromise }) => {
      const n = await liftEither(Right(2))
      return await fromPromise(Promise.resolve(Right(n * 21)))
    }).run()
    assert.equal(result.extract(), 42)
  })
})

describe('purify-ts codecs: primitives', ({ test }) => {
  test('string, number, boolean accept and reject', ({ assert }) => {
    assert.equal(string.decode('a').extract(), 'a')
    assert.isTrue(string.decode(1).isLeft())
    assert.equal(number.decode(1).extract(), 1)
    assert.isTrue(number.decode('1').isLeft())
    assert.equal(boolean.decode(true).extract(), true)
    assert.isTrue(boolean.decode('true').isLeft())
  })

  test('nullType and unknown', ({ assert }) => {
    assert.equal(nullType.decode(null).extract(), null)
    assert.isTrue(nullType.decode(undefined).isLeft())
    assert.equal(unknown.decode(Symbol.iterator).isRight(), true)
  })

  test('date round trips', ({ assert }) => {
    const iso = '2020-01-02T03:04:05.000Z'
    const decoded = date.decode(iso)
    assert.isTrue(decoded.isRight())
    assert.instanceOf(decoded.extract(), Date)
    assert.equal(date.encode(new Date(iso)), iso)
  })
})

describe('purify-ts codecs: combinators', ({ test }) => {
  test('optional and nullable', ({ assert }) => {
    assert.isTrue(optional(string).decode(undefined).isRight())
    assert.isTrue(optional(string).decode(1).isLeft())
    assert.equal(nullable(string).decode(null).extract(), null)
    assert.equal(nullable(string).decode('a').extract(), 'a')
  })

  test('array, record, map', ({ assert }) => {
    assert.deepEqual(array(number).decode([1, 2]).extract(), [1, 2])
    assert.isTrue(array(number).decode([1, 'a']).isLeft())
    assert.deepEqual(record(string, number).decode({ a: 1 }).extract(), { a: 1 })
    const decodedMap = map(string, number).decode([['a', 1]])
    assert.isTrue(decodedMap.isRight())
    assert.equal(decodedMap.extract().get('a'), 1)
  })

  test('tuple and exactly', ({ assert }) => {
    assert.deepEqual(tuple([string, number]).decode(['a', 1]).extract(), ['a', 1])
    assert.isTrue(tuple([string, number]).decode(['a']).isLeft())
    assert.equal(exactly('NODE-HID').decode('NODE-HID').extract(), 'NODE-HID')
    assert.isTrue(exactly('NODE-HID').decode('BARE-HID').isLeft())
  })

  test('oneOf and enumeration', ({ assert }) => {
    const codec = oneOf([string, number])
    assert.equal(codec.decode('a').extract(), 'a')
    assert.equal(codec.decode(1).extract(), 1)
    assert.isTrue(codec.decode(true).isLeft())

    const Transport = { NodeHid: 'NODE-HID', BareHid: 'BARE-HID' }
    assert.equal(enumeration(Transport).decode('BARE-HID').extract(), 'BARE-HID')
    assert.isTrue(enumeration(Transport).decode('WEB-HID').isLeft())
  })

  test('maybe and nonEmptyList', ({ assert }) => {
    assert.isTrue(maybe(string).decode(undefined).extract().isNothing())
    assert.equal(maybe(string).decode('a').extract().extract(), 'a')
    assert.deepEqual(nonEmptyList(number).decode([1]).extract(), [1])
    assert.isTrue(nonEmptyList(number).decode([]).isLeft())
  })

  test('lazy defers resolution, for recursive shapes', ({ assert }) => {
    const codec = Codec.interface({
      value: number,
      next: optional(lazy(() => codec)),
    })
    assert.isTrue(codec.decode({ value: 1, next: { value: 2 } }).isRight())
  })
})

describe('purify-ts codecs: composition', ({ test }) => {
  test('Codec.interface decodes and encodes', ({ assert }) => {
    const Device = Codec.interface({ id: string, opened: boolean })
    const decoded = Device.decode({ id: 'nano-x', opened: true })
    assert.isTrue(decoded.isRight())
    assert.deepEqual(decoded.extract(), { id: 'nano-x', opened: true })
    assert.isTrue(Device.decode({ id: 1, opened: true }).isLeft())
    assert.deepEqual(Device.encode({ id: 'nano-x', opened: true }), {
      id: 'nano-x',
      opened: true,
    })
  })

  test('Codec.custom carries user logic', ({ assert }) => {
    const FrameSize = Codec.custom({
      decode: (value) =>
        value === 64 ? Right(value) : Left(`expected 64, got ${value}`),
      encode: (value) => value,
    })
    assert.equal(FrameSize.decode(64).extract(), 64)
    assert.isTrue(FrameSize.decode(32).isLeft())
  })

  test('intersect merges two interfaces', ({ assert }) => {
    const codec = intersect(
      Codec.interface({ id: string }),
      Codec.interface({ frame: number }),
    )
    assert.deepEqual(codec.decode({ id: 'a', frame: 64 }).extract(), {
      id: 'a',
      frame: 64,
    })
    assert.isTrue(codec.decode({ id: 'a' }).isLeft())
  })

  test('parseError turns a failure into a structured report', ({ assert }) => {
    const failure = Codec.interface({ id: string }).decode({ id: 1 })
    assert.isTrue(failure.isLeft())
    const parsed = parseError(failure.extract())
    assert.isExist(parsed)
    assert.equal(typeof parsed, 'object')
  })
})

describe('purify-ts: List', ({ test }) => {
  test('head, last, init, tail return Maybe', ({ assert }) => {
    assert.equal(List.head([1, 2, 3]).extract(), 1)
    assert.equal(List.last([1, 2, 3]).extract(), 3)
    assert.deepEqual(List.init([1, 2, 3]).extract(), [1, 2])
    assert.deepEqual(List.tail([1, 2, 3]).extract(), [2, 3])
    assert.isTrue(List.head([]).isNothing())
  })

  test('at, find, findIndex', ({ assert }) => {
    assert.equal(List.at(1, [1, 2, 3]).extract(), 2)
    assert.isTrue(List.at(9, [1, 2, 3]).isNothing())
    assert.equal(List.find((n) => n > 1, [1, 2, 3]).extract(), 2)
    assert.equal(List.findIndex((n) => n > 1, [1, 2, 3]).extract(), 1)
  })

  test('uncons splits into a Tuple', ({ assert }) => {
    const unconsed = List.uncons([1, 2, 3])
    assert.isTrue(unconsed.isJust())
    assert.equal(unconsed.extract().fst(), 1)
    assert.deepEqual(unconsed.extract().snd(), [2, 3])
  })

  test('sum and sort', ({ assert }) => {
    assert.equal(List.sum([1, 2, 3]), 6)
    assert.deepEqual(List.sort(compare, [3, 1, 2]), [1, 2, 3])
  })
})

describe('purify-ts: NonEmptyList', ({ test }) => {
  test('fromArray guards emptiness', ({ assert }) => {
    assert.isTrue(NonEmptyList.fromArray([1]).isJust())
    assert.isTrue(NonEmptyList.fromArray([]).isNothing())
    assert.isTrue(NonEmptyList.isNonEmpty([1]))
    assert.isFalse(NonEmptyList.isNonEmpty([]))
  })

  test('unsafeCoerce throws on empty', ({ assert }) => {
    assert.deepEqual(NonEmptyList.unsafeCoerce([1, 2]), [1, 2])
    assert.throws(() => NonEmptyList.unsafeCoerce([]), /.*/)
  })

  test('head and last need no Maybe', ({ assert }) => {
    const list = NonEmptyList([1, 2, 3])
    assert.equal(NonEmptyList.head(list), 1)
    assert.equal(NonEmptyList.last(list), 3)
  })
})

describe('purify-ts: Tuple', ({ test }) => {
  test('fst, snd, and iteration', ({ assert }) => {
    const tuple = Tuple('id', 64)
    assert.equal(tuple.fst(), 'id')
    assert.equal(tuple.snd(), 64)
    assert.deepEqual([...tuple], ['id', 64])
  })

  test('map, bimap, swap', ({ assert }) => {
    const tuple = Tuple('id', 64)
    assert.equal(tuple.map((n) => n * 2).snd(), 128)
    const bimapped = tuple.bimap((s) => s.toUpperCase(), (n) => n + 1)
    assert.deepEqual([...bimapped], ['ID', 65])
    assert.deepEqual([...tuple.swap()], [64, 'id'])
  })

  test('fanout builds a Tuple from one value', ({ assert }) => {
    const tuple = Tuple.fanout(
      (s) => s.length,
      (s) => s.toUpperCase(),
      'hid',
    )
    assert.deepEqual([...tuple], [3, 'HID'])
  })
})

describe('purify-ts: MaybeAsync', ({ test }) => {
  test('run resolves to Just', async ({ assert }) => {
    const result = await MaybeAsync(async ({ liftMaybe }) => {
      const value = await liftMaybe(Just(21))
      return value * 2
    }).run()
    assert.isTrue(result.isJust())
    assert.equal(result.extract(), 42)
  })

  test('a lifted Nothing short circuits', async ({ assert }) => {
    const result = await MaybeAsync(async ({ liftMaybe }) => {
      await liftMaybe(Nothing)
      throw new Error('continued past a Nothing')
    }).run()
    assert.isTrue(result.isNothing())
  })

  test('fromPromise threads async work', async ({ assert }) => {
    const result = await MaybeAsync.fromPromise(async () =>
      Maybe.fromNullable('nano-x'),
    ).run()
    assert.equal(result.extract(), 'nano-x')
  })
})

describe('purify-ts: function helpers', ({ test }) => {
  test('identity and always', ({ assert }) => {
    assert.equal(identity(7), 7)
    assert.equal(always(7)('ignored'), 7)
  })

  test('curry applies arguments progressively', ({ assert }) => {
    const add = curry((a, b, c) => a + b + c)
    assert.equal(add(1)(2)(3), 6)
    assert.equal(add(1, 2)(3), 6)
    assert.equal(add(1, 2, 3), 6)
  })

  test('Order, compare, orderToNumber', ({ assert }) => {
    assert.equal(compare(1, 2), Order.LT)
    assert.equal(compare(2, 2), Order.EQ)
    assert.equal(compare(3, 2), Order.GT)
    assert.equal(orderToNumber(Order.LT), -1)
    assert.equal(orderToNumber(Order.EQ), 0)
    assert.equal(orderToNumber(Order.GT), 1)
  })
})

describe('purify-ts: coverage guard', ({ test }) => {
  /**
   * Every name purify-ts exports, and the group above that exercises it. If an upgrade adds
   * an export, this fails and the new name has to be covered before the probe can claim the
   * library runs under Bare.
   */
  const COVERED = {
    Either: 'core',
    EitherAsync: 'core',
    Just: 'core',
    Left: 'core',
    Maybe: 'core',
    Nothing: 'core',
    Right: 'core',
    Codec: 'codecs',
    array: 'codecs',
    boolean: 'codecs',
    date: 'codecs',
    enumeration: 'codecs',
    exactly: 'codecs',
    intersect: 'codecs',
    lazy: 'codecs',
    map: 'codecs',
    maybe: 'codecs',
    nonEmptyList: 'codecs',
    nullType: 'codecs',
    nullable: 'codecs',
    number: 'codecs',
    oneOf: 'codecs',
    optional: 'codecs',
    parseError: 'codecs',
    record: 'codecs',
    string: 'codecs',
    tuple: 'codecs',
    unknown: 'codecs',
    List: 'data',
    MaybeAsync: 'data',
    NonEmptyList: 'data',
    Order: 'data',
    Tuple: 'data',
    always: 'data',
    compare: 'data',
    curry: 'data',
    identity: 'data',
    orderToNumber: 'data',
  }

  test('every export is exercised by one of the probes', async ({ assert }) => {
    const purify = await import('purify-ts')
    const exported = Object.keys(purify).sort()
    const covered = Object.keys(COVERED).sort()
    assert.equal(exported.length, covered.length)
    assert.deepEqual(exported, covered)
  })
})
