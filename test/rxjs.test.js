import { describe } from 'noba'
import {
  BehaviorSubject,
  EMPTY,
  NEVER,
  Observable,
  ReplaySubject,
  Subject,
  Subscription,
  catchError,
  concatMap,
  debounceTime,
  delay,
  distinctUntilChanged,
  filter,
  finalize,
  firstValueFrom,
  from,
  interval,
  lastValueFrom,
  map,
  mergeMap,
  of,
  retry,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
  timer,
  toArray,
} from 'rxjs'

/**
 * Bare compatibility probe for rxjs.
 *
 * rxjs carries every asynchronous result in the DMK, and the transport itself imports
 * BehaviorSubject, from, map, Observable, and switchMap. Its risk profile under Bare is not
 * the operator algebra, which is plain JavaScript, but the host it leans on: timers,
 * microtask scheduling, Symbol.observable, and teardown on unsubscribe. Those get the most
 * attention below.
 *
 * Runs on Bare only: `pnpm test` is `noba-bare`.
 */
describe('rxjs: module loading', ({ test }) => {
  test('the package and its operators subpath both resolve', async ({ assert }) => {
    const root = await import('rxjs')
    const operators = await import('rxjs/operators')
    assert.isTrue(Object.keys(root).length > 100)
    assert.equal(typeof operators.map, 'function')
    assert.equal(typeof Observable, 'function')
  })

  test('Symbol.observable interop is wired', ({ assert }) => {
    const source = of(1)
    const interop = source[Symbol.observable ?? '@@observable']
    assert.equal(typeof interop, 'function')
    assert.equal(interop.call(source), source)
  })
})

describe('rxjs: creation and subscription', ({ test }) => {
  test('a hand rolled Observable emits, completes, and tears down', ({ assert }) => {
    const seen = []
    let torndown = false
    const source = new Observable((subscriber) => {
      subscriber.next(1)
      subscriber.next(2)
      subscriber.complete()
      return () => {
        torndown = true
      }
    })
    source.subscribe({ next: (v) => seen.push(v), complete: () => seen.push('done') })
    assert.deepEqual(seen, [1, 2, 'done'])
    assert.isTrue(torndown)
  })

  test('of, from array, from promise, from iterable', async ({ assert }) => {
    assert.deepEqual(await lastValueFrom(of(1, 2, 3).pipe(toArray())), [1, 2, 3])
    assert.deepEqual(await lastValueFrom(from([1, 2]).pipe(toArray())), [1, 2])
    assert.equal(await lastValueFrom(from(Promise.resolve('x'))), 'x')
    assert.deepEqual(
      await lastValueFrom(from(new Set([1, 2])).pipe(toArray())),
      [1, 2],
    )
  })

  test('EMPTY completes without a value and NEVER does neither', ({ assert }) => {
    let completed = false
    EMPTY.subscribe({ complete: () => (completed = true) })
    assert.isTrue(completed)

    let touched = false
    const sub = NEVER.subscribe({
      next: () => (touched = true),
      complete: () => (touched = true),
    })
    sub.unsubscribe()
    assert.isFalse(touched)
  })

  test('unsubscribe stops delivery and Subscription composes', ({ assert }) => {
    const subject = new Subject()
    const seen = []
    const parent = new Subscription()
    parent.add(subject.subscribe((v) => seen.push(v)))
    subject.next(1)
    parent.unsubscribe()
    subject.next(2)
    assert.deepEqual(seen, [1])
  })
})

describe('rxjs: subjects', ({ test }) => {
  test('Subject multicasts to live subscribers only', ({ assert }) => {
    const subject = new Subject()
    const seen = []
    subject.next('missed')
    subject.subscribe((v) => seen.push(v))
    subject.next('caught')
    assert.deepEqual(seen, ['caught'])
  })

  test('BehaviorSubject replays its current value, as the transport relies on', ({
    assert,
  }) => {
    const subject = new BehaviorSubject([])
    const seen = []
    subject.subscribe((v) => seen.push(v))
    subject.next(['nano-x'])
    assert.deepEqual(seen, [[], ['nano-x']])
    assert.deepEqual(subject.getValue(), ['nano-x'])
  })

  test('ReplaySubject buffers', ({ assert }) => {
    const subject = new ReplaySubject(2)
    subject.next(1)
    subject.next(2)
    subject.next(3)
    const seen = []
    subject.subscribe((v) => seen.push(v))
    assert.deepEqual(seen, [2, 3])
  })
})

describe('rxjs: operators', ({ test }) => {
  test('map, filter, take, toArray', async ({ assert }) => {
    const result = await lastValueFrom(
      from([1, 2, 3, 4]).pipe(
        map((n) => n * 2),
        filter((n) => n > 2),
        take(2),
        toArray(),
      ),
    )
    assert.deepEqual(result, [4, 6])
  })

  test('switchMap flattens, as the transport uses it', async ({ assert }) => {
    const result = await lastValueFrom(
      from([1, 2]).pipe(
        switchMap((n) => of(`device-${n}`)),
        toArray(),
      ),
    )
    assert.deepEqual(result, ['device-1', 'device-2'])
  })

  test('switchMap cancels an inner that is still pending', async ({ assert }) => {
    const result = await lastValueFrom(
      from([1, 2]).pipe(
        switchMap((n) => of(`device-${n}`).pipe(delay(10))),
        toArray(),
      ),
    )
    assert.deepEqual(result, ['device-2'])
  })

  test('mergeMap and concatMap preserve their contracts', async ({ assert }) => {
    assert.deepEqual(
      await lastValueFrom(from([1, 2]).pipe(mergeMap((n) => of(n, n)), toArray())),
      [1, 1, 2, 2],
    )
    assert.deepEqual(
      await lastValueFrom(from([1, 2]).pipe(concatMap((n) => of(n * 10)), toArray())),
      [10, 20],
    )
  })

  test('tap, distinctUntilChanged, finalize', async ({ assert }) => {
    const tapped = []
    let finalized = false
    const result = await lastValueFrom(
      from([1, 1, 2, 2, 3]).pipe(
        tap((n) => tapped.push(n)),
        distinctUntilChanged(),
        finalize(() => (finalized = true)),
        toArray(),
      ),
    )
    assert.deepEqual(result, [1, 2, 3])
    assert.equal(tapped.length, 5)
    assert.isTrue(finalized)
  })

  test('shareReplay multicasts one subscription', async ({ assert }) => {
    let subscriptions = 0
    const source = new Observable((subscriber) => {
      subscriptions += 1
      subscriber.next('shared')
      subscriber.complete()
    }).pipe(shareReplay(1))
    assert.equal(await firstValueFrom(source), 'shared')
    assert.equal(await firstValueFrom(source), 'shared')
    assert.equal(subscriptions, 1)
  })
})

describe('rxjs: errors', ({ test }) => {
  test('throwError reaches the error handler', ({ assert }) => {
    let caught = null
    throwError(() => new Error('no accessible device')).subscribe({
      error: (error) => (caught = error),
    })
    assert.instanceOf(caught, Error)
  })

  test('catchError substitutes a fallback', async ({ assert }) => {
    const result = await lastValueFrom(
      throwError(() => new Error('boom')).pipe(catchError(() => of('fallback'))),
    )
    assert.equal(result, 'fallback')
  })

  test('retry resubscribes before giving up', async ({ assert }) => {
    let attempts = 0
    const source = new Observable((subscriber) => {
      attempts += 1
      if (attempts < 3) subscriber.error(new Error('flaky'))
      else {
        subscriber.next('ok')
        subscriber.complete()
      }
    })
    assert.equal(await lastValueFrom(source.pipe(retry(3))), 'ok')
    assert.equal(attempts, 3)
  })

  test('firstValueFrom rejects on an empty stream', async ({ assert }) => {
    await assert.rejects(() => firstValueFrom(EMPTY), /.*/)
  })
})

describe('rxjs: scheduling on Bare timers', ({ test }) => {
  test('timer fires', async ({ assert }) => {
    assert.equal(await firstValueFrom(timer(5)), 0)
  })

  test('interval ticks and stops on takeUntil', async ({ assert }) => {
    const result = await lastValueFrom(
      interval(2).pipe(takeUntil(timer(25)), toArray()),
    )
    assert.isTrue(result.length >= 2)
    assert.equal(result[0], 0)
  })

  test('delay shifts emission without losing it', async ({ assert }) => {
    assert.equal(await firstValueFrom(of('late').pipe(delay(5))), 'late')
  })

  test('debounceTime collapses a burst', async ({ assert }) => {
    const subject = new Subject()
    const settled = firstValueFrom(subject.pipe(debounceTime(10)))
    subject.next(1)
    subject.next(2)
    subject.next(3)
    assert.equal(await settled, 3)
  })
})

describe('rxjs: promise interop', ({ test }) => {
  test('firstValueFrom and lastValueFrom, as index.js uses them', async ({ assert }) => {
    assert.equal(await firstValueFrom(from([1, 2, 3])), 1)
    assert.equal(await lastValueFrom(from([1, 2, 3])), 3)
  })

  test('an observable converts to a promise and back', async ({ assert }) => {
    const value = await lastValueFrom(from(Promise.resolve(7)).pipe(map((n) => n + 1)))
    assert.equal(value, 8)
  })
})
