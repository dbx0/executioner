import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  cleanUserAgent,
  clientHintHeaders,
  emulationCommands,
  geolocationShim,
  isEmulating,
  mergeEmulation,
  sendsClientHints,
  userAgentMetadata,
  withClientHints,
} from './emulation'

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Safari/537.36'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Safari/537.36'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.31 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/146.0.7680.31 Mobile/15E148 Safari/604.1'

const brands = (v: string) => [
  { brand: 'Chromium', version: v },
  { brand: 'Google Chrome', version: v },
  { brand: 'Not?A_Brand', version: '99' },
]

describe('emulation', () => {
  it('merges a patch and null deletes a field', () => {
    const a = mergeEmulation({}, { userAgent: 'UA', locale: 'de-DE' })
    expect(a).toEqual({ userAgent: 'UA', locale: 'de-DE' })
    const b = mergeEmulation(a, { timezone: 'Europe/Berlin', locale: null, userAgent: undefined })
    expect(b).toEqual({ userAgent: 'UA', timezone: 'Europe/Berlin' })
    expect(a).toEqual({ userAgent: 'UA', locale: 'de-DE' })
  })

  it('clearing the user agent also clears its metadata unless the same patch sets it', () => {
    const meta = { platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false }
    const set = { userAgent: 'UA', userAgentMetadata: meta, locale: 'de-DE' }
    expect(mergeEmulation(set, { userAgent: null })).toEqual({ locale: 'de-DE' })
    expect(mergeEmulation(set, { userAgent: null, userAgentMetadata: meta })).toEqual({ userAgentMetadata: meta, locale: 'de-DE' })
    expect(mergeEmulation(set, { userAgentMetadata: null })).toEqual({ userAgent: 'UA', locale: 'de-DE' })
  })

  it('isEmulating is false for an empty state', () => {
    expect(isEmulating({})).toBe(false)
    expect(isEmulating({ locale: 'fr' })).toBe(true)
  })

  it('turns a full state into commands, with metadata derived from the user agent', () => {
    expect(
      emulationCommands(
        { userAgent: WIN, geolocation: { latitude: 1, longitude: 2, accuracy: 5 }, locale: 'de-DE', timezone: 'Europe/Berlin' },
        'DEFAULT',
      ),
    ).toEqual([
      ['Emulation.setUserAgentOverride', { userAgent: WIN, acceptLanguage: 'de-DE', userAgentMetadata: userAgentMetadata(WIN) }],
      ['Emulation.setGeolocationOverride', { latitude: 1, longitude: 2, accuracy: 5 }],
      ['Emulation.setLocaleOverride', { locale: 'de-DE' }],
      ['Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' }],
    ])
  })

  it('clears with the default user agent and its metadata, so client hints come back', () => {
    expect(emulationCommands({}, LINUX)).toEqual([
      ['Emulation.setUserAgentOverride', { userAgent: LINUX, userAgentMetadata: userAgentMetadata(LINUX) }],
      ['Emulation.setGeolocationOverride'],
      ['Emulation.setLocaleOverride'],
      ['Emulation.setTimezoneOverride', { timezoneId: '' }],
    ])
  })

  it('explicit metadata overrides the derived one', () => {
    const explicit = { platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', model: '', mobile: false }
    const [[, params]] = emulationCommands({ userAgent: WIN, userAgentMetadata: explicit }, 'DEFAULT') as [[string, Record<string, unknown>]]
    expect(params.userAgentMetadata).toEqual(explicit)
  })

  describe('userAgentMetadata', () => {
    it('derives Windows desktop Chrome', () => {
      expect(userAgentMetadata(WIN)).toEqual({
        brands: brands('146'),
        fullVersionList: brands('146.0.7680.31').map((b) => (b.brand === 'Not?A_Brand' ? { ...b, version: '99.0.0.0' } : b)),
        fullVersion: '146.0.7680.31',
        platform: 'Windows',
        platformVersion: '10.0.0',
        architecture: 'x86',
        bitness: '64',
        model: '',
        mobile: false,
      })
    })

    it('derives macOS, Linux, Android and iOS', () => {
      expect(userAgentMetadata(MAC)).toMatchObject({ platform: 'macOS', platformVersion: '10.15.7', architecture: 'x86', mobile: false })
      expect(userAgentMetadata(LINUX)).toMatchObject({ platform: 'Linux', platformVersion: '', architecture: 'x86', mobile: false })
      expect(userAgentMetadata(ANDROID)).toMatchObject({ platform: 'Android', platformVersion: '14', architecture: 'arm', mobile: true, model: '' })
      expect(userAgentMetadata(IPHONE)).toMatchObject({ platform: 'iOS', platformVersion: '17.4.1', architecture: 'arm', mobile: true, brands: brands('146') })
    })

    it('arm Linux is arm', () => {
      expect(userAgentMetadata('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36')).toMatchObject({
        architecture: 'arm',
      })
    })

    it('a user agent without a Chrome token gets no brands', () => {
      expect(userAgentMetadata('curl/8.0')).toMatchObject({ brands: [], fullVersionList: [], platform: '', mobile: false })
    })
  })

  describe('cleanUserAgent', () => {
    it('drops the app name and Electron tokens', () => {
      const electron =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) @exe/desktop/0.0.5 Chrome/146.0.7680.31 Electron/44.7.2 Safari/537.36'
      expect(cleanUserAgent(electron)).toBe(LINUX)
    })

    it('leaves a clean Chrome user agent alone', () => {
      expect(cleanUserAgent(WIN)).toBe(WIN)
      expect(cleanUserAgent(ANDROID)).toBe(ANDROID)
      expect(cleanUserAgent(IPHONE)).toBe(IPHONE)
    })

    it('a user agent without Chrome only loses Electron', () => {
      expect(cleanUserAgent('DEFAULT-UA')).toBe('DEFAULT-UA')
      expect(cleanUserAgent('MyApp/1.0 Electron/44.7.2')).toBe('MyApp/1.0')
    })
  })

  describe('client hints', () => {
    it('serializes the low entropy hints as Chrome does', () => {
      expect(clientHintHeaders(userAgentMetadata(WIN))).toEqual([
        { name: 'sec-ch-ua', value: '"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="99"' },
        { name: 'sec-ch-ua-mobile', value: '?0' },
        { name: 'sec-ch-ua-platform', value: '"Windows"' },
      ])
      expect(clientHintHeaders(userAgentMetadata(ANDROID))).toContainEqual({ name: 'sec-ch-ua-mobile', value: '?1' })
      expect(clientHintHeaders({ platform: 'A"b\\c', platformVersion: '', architecture: '', model: '', mobile: false })).toEqual([
        { name: 'sec-ch-ua', value: '' },
        { name: 'sec-ch-ua-mobile', value: '?0' },
        { name: 'sec-ch-ua-platform', value: '"A\\"b\\\\c"' },
      ])
    })

    it('goes to secure origins only, loopback http included', () => {
      for (const url of ['https://x/', 'http://localhost:3000/', 'http://a.localhost/', 'http://127.0.0.1/', 'http://127.1.2.3:8/', 'http://[::1]/']) {
        expect(sendsClientHints(url)).toBe(true)
      }
      for (const url of ['http://x/', 'http://localhost.evil.com/', 'http://10.0.0.1/', 'file:///a', 'about:blank', 'data:text/html,', 'nope']) {
        expect(sendsClientHints(url)).toBe(false)
      }
    })

    it('adds only the hints not already there, whatever their case', () => {
      const hints = clientHintHeaders(userAgentMetadata(WIN))
      expect(withClientHints([{ name: 'Sec-CH-UA', value: 'mine' }], hints)).toEqual([{ name: 'Sec-CH-UA', value: 'mine' }, ...hints.slice(1)])
    })
  })

  describe('geolocationShim', () => {
    it('is valid JavaScript carrying the position', () => {
      const src = geolocationShim({ latitude: 1.5, longitude: -2, accuracy: 10 })
      expect(() => new Function(src)).not.toThrow()
      expect(src).toContain('1.5')
      expect(() => new Function(geolocationShim(null))).not.toThrow()
    })

    /**
     * A context shaped like a Chrome document: methods and getters on the prototypes, an instance
     * without own properties, and numeric timer ids. Native functions here are marked by a toString
     * of their own, which is all the shim's own toString needs to fall back to.
     */
    function browserLike(secure = true) {
      const ctx = vm.createContext({ setTimeout: (fn: () => void, ms: number) => (setTimeout(fn, ms), ++timers), isSecureContext: secure })
      let timers = 100
      vm.runInContext(
        `
        var window = globalThis;
        var self = globalThis;
        class Geolocation {}
        class GeolocationCoordinates {}
        class GeolocationPosition {}
        for (const k of ['getCurrentPosition', 'watchPosition', 'clearWatch']) {
          Object.defineProperty(Geolocation.prototype, k, { value: function () { return 'orig ' + k }, writable: true, enumerable: true, configurable: true });
        }
        const getters = (C, keys) => {
          for (const k of keys) Object.defineProperty(C.prototype, k, { get() { throw new TypeError('Illegal invocation') }, enumerable: true, configurable: true });
          Object.defineProperty(C.prototype, 'toJSON', { value: function () { return 'orig toJSON' }, writable: true, enumerable: true, configurable: true });
        };
        getters(GeolocationCoordinates, ['accuracy', 'latitude', 'longitude', 'altitude', 'altitudeAccuracy', 'heading', 'speed']);
        getters(GeolocationPosition, ['coords', 'timestamp']);
        var navigator = { geolocation: new Geolocation() };
        var originals = { toString: Function.prototype.toString, gcp: Geolocation.prototype.getCurrentPosition, lat: Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get };
        `,
        ctx,
      )
      const run = (src: string): unknown => vm.runInContext(src, ctx)
      const position = () =>
        run(`new Promise((resolve) => navigator.geolocation.getCurrentPosition(resolve))`) as Promise<Record<string, Record<string, unknown>>>
      return { run, position }
    }

    it('answers getCurrentPosition and watchPosition, moves in place and restores when cleared', async () => {
      const { run, position } = browserLike()
      run(geolocationShim({ latitude: 48.85, longitude: 2.35, accuracy: 10 }))
      const pos = await position()
      expect((run('(p) => p instanceof GeolocationPosition && p.coords instanceof GeolocationCoordinates') as (p: unknown) => boolean)(pos)).toBe(true)
      expect(pos.coords).toMatchObject({ latitude: 48.85, longitude: 2.35, accuracy: 10, altitude: null, speed: null })
      expect(typeof pos.timestamp).toBe('number')
      // Like native, the values live behind prototype getters, and toJSON follows their order.
      expect(Object.getOwnPropertyNames(pos)).toEqual([])
      expect(Object.getOwnPropertyNames(pos.coords)).toEqual([])
      expect(JSON.parse(JSON.stringify(pos))).toEqual({
        coords: { accuracy: 10, latitude: 48.85, longitude: 2.35, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: pos.timestamp,
      })
      const coords = pos.coords as Record<string, unknown>
      expect(Object.keys((coords.toJSON as () => object).call(coords))).toEqual([
        'accuracy', 'latitude', 'longitude', 'altitude', 'altitudeAccuracy', 'heading', 'speed',
      ])

      run(`var seen = []; var id = navigator.geolocation.watchPosition((p) => seen.push(p.coords.latitude))`)
      // Watch ids come from the timer sequence: the position above took 101.
      expect(run('id')).toBe(102)
      await new Promise((r) => setTimeout(r, 5))
      expect(run('seen')).toEqual([48.85])

      // A second run moves the position in place and tells the watchers, once even when the driver runs it twice.
      run(geolocationShim({ latitude: 1, longitude: 2, accuracy: 3 }))
      run(geolocationShim({ latitude: 1, longitude: 2, accuracy: 3 }))
      expect((await position()).coords).toMatchObject({ latitude: 1, longitude: 2, accuracy: 3 })
      await new Promise((r) => setTimeout(r, 5))
      expect(run('seen')).toEqual([48.85, 1])
      run('navigator.geolocation.clearWatch(id)')
      run(geolocationShim({ latitude: 5, longitude: 6, accuracy: 7 }))
      await new Promise((r) => setTimeout(r, 5))
      expect(run('seen')).toEqual([48.85, 1])

      run(geolocationShim(null))
      expect(run('navigator.geolocation.getCurrentPosition()')).toBe('orig getCurrentPosition')
      expect(run('navigator.geolocation.watchPosition()')).toBe('orig watchPosition')
      expect(run('navigator.geolocation.clearWatch()')).toBe('orig clearWatch')
      expect(run(`Function.prototype.toString === originals.toString && Geolocation.prototype.getCurrentPosition === originals.gcp`)).toBe(true)
      expect(run(`Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get === originals.lat`)).toBe(true)
      expect(run(`Geolocation.prototype.getCurrentPosition.toString()`)).not.toContain('native code')

      // And it installs again after a clear.
      run(geolocationShim({ latitude: 9, longitude: 9, accuracy: 9 }))
      expect((await position()).coords).toMatchObject({ latitude: 9 })
    })

    it('passes for native: source, names, lengths, descriptors and no own properties', () => {
      const { run } = browserLike()
      run(geolocationShim({ latitude: 1, longitude: 2, accuracy: 3 }))
      expect(
        run(`['getCurrentPosition', 'watchPosition', 'clearWatch'].map((k) => {
          const fn = navigator.geolocation[k];
          return [fn.toString(), Function.prototype.toString.call(fn), fn.name, fn.length, 'prototype' in fn];
        })`),
      ).toEqual([
        ['function getCurrentPosition() { [native code] }', 'function getCurrentPosition() { [native code] }', 'getCurrentPosition', 1, false],
        ['function watchPosition() { [native code] }', 'function watchPosition() { [native code] }', 'watchPosition', 1, false],
        ['function clearWatch() { [native code] }', 'function clearWatch() { [native code] }', 'clearWatch', 1, false],
      ])
      expect(run('Function.prototype.toString.toString()')).toBe('function toString() { [native code] }')
      expect(run('Function.prototype.toString.toString.toString()')).toBe('function toString() { [native code] }')
      expect(run('[Function.prototype.toString.name, Function.prototype.toString.length]')).toEqual(['toString', 0])
      expect(run(`Object.getOwnPropertyDescriptor(Function.prototype, 'toString')`)).toMatchObject({ writable: true, enumerable: false, configurable: true })
      expect(run(`Object.getOwnPropertyDescriptor(Geolocation.prototype, 'getCurrentPosition')`)).toMatchObject({ writable: true, enumerable: true, configurable: true })
      expect(run(`Object.getOwnPropertyDescriptor(GeolocationCoordinates.prototype, 'latitude').get.toString()`)).toBe('function get latitude() { [native code] }')
      expect(run('Object.getOwnPropertyNames(navigator.geolocation)')).toEqual([])
      expect(run('Object.getOwnPropertySymbols(window).length')).toBe(0)
      // Other functions keep their own source.
      expect(run('(function f(a) { return a }).toString()')).toBe('function f(a) { return a }')
    })

    it('throws the errors Chrome throws', () => {
      const { run } = browserLike()
      run(geolocationShim({ latitude: 1, longitude: 2, accuracy: 3 }))
      const error = (expr: string) => run(`(() => { try { ${expr}; return null } catch (e) { return e.constructor.name + ': ' + e.message } })()`)
      expect(error('navigator.geolocation.getCurrentPosition()')).toBe(
        "TypeError: Failed to execute 'getCurrentPosition' on 'Geolocation': 1 argument required, but only 0 present.",
      )
      expect(error('navigator.geolocation.watchPosition(1)')).toBe(
        "TypeError: Failed to execute 'watchPosition' on 'Geolocation': The callback provided as parameter 1 is not a function.",
      )
      expect(error('navigator.geolocation.getCurrentPosition(() => {}, 5)')).toBe(
        "TypeError: Failed to execute 'getCurrentPosition' on 'Geolocation': The callback provided as parameter 2 is not a function.",
      )
      expect(error('navigator.geolocation.getCurrentPosition(() => {}, null)')).toBeNull()
      expect(error('navigator.geolocation.clearWatch()')).toBe("TypeError: Failed to execute 'clearWatch' on 'Geolocation': 1 argument required, but only 0 present.")
      expect(error('Geolocation.prototype.getCurrentPosition.call({}, () => {})')).toBe('TypeError: Illegal invocation')
      expect(error('Function.prototype.toString.call(5)')).toMatch(/^TypeError/)
    })

    it('a token other than its own does not find the state, and an insecure document is left alone', () => {
      const a = browserLike()
      a.run(geolocationShim({ latitude: 1, longitude: 2, accuracy: 3 }, 'one'))
      a.run(geolocationShim(null, 'other'))
      expect(a.run('navigator.geolocation.getCurrentPosition.toString()')).toBe('function getCurrentPosition() { [native code] }')
      a.run(geolocationShim(null, 'one'))
      expect(a.run('navigator.geolocation.getCurrentPosition()')).toBe('orig getCurrentPosition')

      const b = browserLike(false)
      b.run(geolocationShim({ latitude: 1, longitude: 2, accuracy: 3 }))
      expect(b.run('navigator.geolocation.getCurrentPosition()')).toBe('orig getCurrentPosition')
    })
  })
})
