import { randomUUID } from 'node:crypto'
import type { HeaderEntry } from './rewrite'

export interface Geolocation {
  latitude: number
  longitude: number
  accuracy?: number
}

/** CDP Emulation.UserAgentMetadata: what client hints and navigator.userAgentData report. */
export interface UserAgentMetadata {
  brands?: { brand: string; version: string }[]
  fullVersionList?: { brand: string; version: string }[]
  fullVersion?: string
  platform: string
  platformVersion: string
  architecture: string
  model: string
  mobile: boolean
  bitness?: string
  wow64?: boolean
}

export interface EmulationState {
  userAgent?: string
  /** Replaces the metadata derived from the user agent. */
  userAgentMetadata?: UserAgentMetadata
  geolocation?: Geolocation
  locale?: string
  timezone?: string
}

/** A change to the state: a value sets a field, `null` deletes it, and a missing field is left alone. */
export interface EmulationPatch {
  userAgent?: string | null | undefined
  userAgentMetadata?: UserAgentMetadata | null | undefined
  geolocation?: Geolocation | null | undefined
  locale?: string | null | undefined
  timezone?: string | null | undefined
}

const FIELDS = ['userAgent', 'userAgentMetadata', 'geolocation', 'locale', 'timezone'] as const

export function mergeEmulation(current: EmulationState, patch: EmulationPatch): EmulationState {
  const next: Record<string, unknown> = { ...current }
  for (const field of FIELDS) {
    const value = patch[field]
    if (value === null) delete next[field]
    else if (value !== undefined) next[field] = value
  }
  // Metadata describes the user agent it was set with; left behind, it would contradict the default one.
  if (patch.userAgent === null && patch.userAgentMetadata === undefined) delete next.userAgentMetadata
  return next as EmulationState
}

export function isEmulating(state: EmulationState): boolean {
  return FIELDS.some((field) => state[field] !== undefined)
}

export type EmulationCommand = [method: string, params?: Record<string, unknown>]

/**
 * The CDP commands that make a page match the state. Every field gets one, so a cleared field
 * is undone; clearing the user agent needs the browser's own, passed as `defaultUserAgent`.
 * The user agent always goes with metadata: an override without it switches client hints off.
 */
export function emulationCommands(state: EmulationState, defaultUserAgent: string): EmulationCommand[] {
  const { geolocation, locale, timezone } = state
  const userAgent = state.userAgent ?? defaultUserAgent
  return [
    [
      'Emulation.setUserAgentOverride',
      {
        userAgent,
        ...(locale !== undefined ? { acceptLanguage: locale } : {}),
        userAgentMetadata: effectiveUserAgentMetadata(state, defaultUserAgent),
      },
    ],
    geolocation !== undefined
      ? ['Emulation.setGeolocationOverride', { latitude: geolocation.latitude, longitude: geolocation.longitude, accuracy: geolocation.accuracy ?? 100 }]
      : ['Emulation.setGeolocationOverride'],
    locale !== undefined ? ['Emulation.setLocaleOverride', { locale }] : ['Emulation.setLocaleOverride'],
    ['Emulation.setTimezoneOverride', { timezoneId: timezone ?? '' }],
  ]
}

/** The metadata a page reports for the state: the explicit one, or one derived from the user agent in effect. */
export function effectiveUserAgentMetadata(state: EmulationState, defaultUserAgent: string): UserAgentMetadata {
  return state.userAgentMetadata ?? userAgentMetadata(state.userAgent ?? defaultUserAgent)
}

/** Whether Chrome sends client hints to this url: secure origins only, which counts http on loopback. */
export function sendsClientHints(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'https:') return true
  if (parsed.protocol !== 'http:') return false
  const host = parsed.hostname
  return host === 'localhost' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '[::1]'
}

/** A structured header string: quoted, with quotes and backslashes escaped. */
const sfString = (value: string): string => `"${value.replace(/[\\"]/g, '\\$&')}"`

/**
 * The low entropy client hints Chrome sends on every secure request, serialized as Blink does:
 * `"Chromium";v="146", "Google Chrome";v="146"`, `?0` or `?1`, and a quoted platform.
 */
export function clientHintHeaders(meta: UserAgentMetadata): HeaderEntry[] {
  return [
    { name: 'sec-ch-ua', value: (meta.brands ?? []).map((b) => `${sfString(b.brand)};v=${sfString(b.version)}`).join(', ') },
    { name: 'sec-ch-ua-mobile', value: meta.mobile ? '?1' : '?0' },
    { name: 'sec-ch-ua-platform', value: sfString(meta.platform) },
  ]
}

/** The headers with each hint added unless one of that name (in any case) is already there. */
export function withClientHints(headers: readonly HeaderEntry[], hints: readonly HeaderEntry[]): HeaderEntry[] {
  const present = new Set(headers.map((h) => h.name.toLowerCase()))
  return [...headers, ...hints.filter((h) => !present.has(h.name.toLowerCase()))]
}

/** Product tokens a real browser user agent carries; anything else (an app name, Electron/x) is dropped. */
const BROWSER_TOKENS = new Set([
  'Mozilla', 'AppleWebKit', 'Chrome', 'CriOS', 'Safari', 'Mobile', 'Version', 'Gecko', 'Firefox', 'FxiOS', 'Edg', 'EdgA', 'EdgiOS', 'OPR',
])

/**
 * Electron's user agent without the app name and Electron/x tokens, so it reads as plain Chrome.
 * Only a user agent that names Chrome loses its unknown tokens; any other just loses Electron/x.
 */
export function cleanUserAgent(ua: string): string {
  const parts = ua.match(/\([^)]*\)|\S+/g) ?? []
  const chrome = parts.some((part) => /^(?:Chrome|CriOS)\//.test(part))
  const kept = parts.filter((part) => {
    if (part.startsWith('(')) return true
    const name = part.split('/')[0] ?? ''
    return chrome ? BROWSER_TOKENS.has(name) : name !== 'Electron'
  })
  return kept.length > 0 ? kept.join(' ') : ua
}

function platformOf(ua: string): { platform: string; platformVersion: string; mobile: boolean } {
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/.exec(ua)
  if (ios) return { platform: 'iOS', platformVersion: (ios[1] ?? '').replaceAll('_', '.'), mobile: true }
  const android = /Android (\d+(?:\.\d+)*)/.exec(ua)
  if (android) return { platform: 'Android', platformVersion: android[1] ?? '', mobile: /\bMobile\b/.test(ua) }
  const windows = /Windows NT (\d+\.\d+)/.exec(ua)
  if (windows) return { platform: 'Windows', platformVersion: `${windows[1]}.0`, mobile: false }
  const mac = /Mac OS X (\d+(?:[_.]\d+)*)/.exec(ua)
  if (mac) return { platform: 'macOS', platformVersion: (mac[1] ?? '').replaceAll('_', '.'), mobile: false }
  if (/CrOS/.test(ua)) return { platform: 'Chrome OS', platformVersion: '', mobile: false }
  if (/Linux|X11/.test(ua)) return { platform: 'Linux', platformVersion: '', mobile: false }
  return { platform: '', platformVersion: '', mobile: /\bMobile\b/.test(ua) }
}

/** Best-effort client hint metadata for a user agent string, Chrome brands included when it names a Chrome version. */
export function userAgentMetadata(ua: string): UserAgentMetadata {
  const { platform, platformVersion, mobile } = platformOf(ua)
  const arm = platform === 'Android' || platform === 'iOS' || /\b(?:arm|aarch64)/i.test(ua)
  const bits32 = /\b(?:i[3-6]86|armv7|armv8l)\b/i.test(ua) || (/Windows NT/.test(ua) && !/Win64|WOW64|x64/.test(ua))
  const version = /\b(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/.exec(ua)?.[1]
  const brand = /\bEdg(?:A|iOS)?\//.test(ua) ? 'Microsoft Edge' : 'Google Chrome'
  let brands: { brand: string; version: string }[] = []
  let fullVersionList: { brand: string; version: string }[] = []
  let fullVersion = ''
  if (version !== undefined) {
    const parts = version.split('.')
    while (parts.length < 4) parts.push('0')
    fullVersion = parts.join('.')
    const major = parts[0] ?? ''
    brands = [
      { brand: 'Chromium', version: major },
      { brand, version: major },
      { brand: 'Not?A_Brand', version: '99' },
    ]
    fullVersionList = [
      { brand: 'Chromium', version: fullVersion },
      { brand, version: fullVersion },
      { brand: 'Not?A_Brand', version: '99.0.0.0' },
    ]
  }
  return {
    brands,
    fullVersionList,
    fullVersion,
    platform,
    platformVersion,
    architecture: arm ? 'arm' : 'x86',
    bitness: bits32 ? '32' : '64',
    model: '',
    mobile,
  }
}

/** Unguessable by a page; the shim answers it with its state, so a rerun finds it without a global a page could see. */
const SHIM_TOKEN = randomUUID()

/**
 * A script for every document that answers navigator.geolocation from `position`, or with null puts
 * the browser's own functions back. Running it again moves the position in place. It backs up the CDP
 * override, which Electron does not always honour: its location provider can still be asked and fail.
 *
 * It is built to pass for native: the replacements sit on the prototypes like the real ones, with the
 * same names, lengths, argument errors and `[native code]` source (Function.prototype.toString is
 * patched to say so, itself included), and positions are prototype-only objects read through wrapped
 * getters. Insecure documents are left alone, since Chrome refuses them a position anyway.
 */
export function geolocationShim(position: { latitude: number; longitude: number; accuracy: number } | null, token: string = SHIM_TOKEN): string {
  return `(() => {
  'use strict';
  const pos = ${JSON.stringify(position)};
  const TOKEN = ${JSON.stringify(token)};
  if (typeof Geolocation !== 'function' || typeof GeolocationPosition !== 'function' || typeof GeolocationCoordinates !== 'function') return;
  const G = Geolocation.prototype;
  const desc = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  let s;
  try {
    const found = desc(G, 'getCurrentPosition').value.call(TOKEN);
    if (found && found.token === TOKEN) s = found;
  } catch (e) {}
  if (pos === null) {
    if (s) s.restore();
    return;
  }
  if (s) {
    // The script can run twice for one change (on registration and again by evaluate); watchers hear it once.
    const same = s.pos.latitude === pos.latitude && s.pos.longitude === pos.longitude && s.pos.accuracy === pos.accuracy;
    s.pos = pos;
    if (!same) s.notify();
    return;
  }
  if (globalThis.isSecureContext !== true) return;
  const apply = Reflect.apply;
  const later = setTimeout;
  const geo = navigator.geolocation;
  const saved = [];
  const swap = (obj, key, d) => {
    saved.push([obj, key, desc(obj, key)]);
    define(obj, key, d);
  };
  const natives = new WeakMap();
  const native = (fn, name) => {
    natives.set(fn, name);
    return fn;
  };
  const FP = Function.prototype;
  const origToString = FP.toString;
  const toString = native({
    toString() {
      const name = natives.get(this);
      return name !== undefined ? 'function ' + name + '() { [native code] }' : apply(origToString, this, arguments);
    },
  }.toString, 'toString');
  swap(FP, 'toString', { ...desc(FP, 'toString'), value: toString });

  // Fake positions have no own properties; the prototype getters read them from here.
  const data = new WeakMap();
  const wrapProto = (proto) => {
    const keys = [];
    for (const key of Object.getOwnPropertyNames(proto)) {
      const d = desc(proto, key);
      if (typeof d.get !== 'function') continue;
      keys.push(key);
      const orig = d.get;
      const get = desc({ get [key]() { const f = data.get(this); return f !== undefined ? f[key] : apply(orig, this, arguments); } }, key).get;
      swap(proto, key, { ...d, get: native(get, 'get ' + key) });
    }
    const t = desc(proto, 'toJSON');
    if (t && typeof t.value === 'function') {
      const orig = t.value;
      const toJSON = {
        toJSON() {
          const f = data.get(this);
          if (f === undefined) return apply(orig, this, arguments);
          const out = {};
          for (const k of keys) {
            const v = f[k];
            out[k] = v !== null && typeof v === 'object' && data.has(v) ? v.toJSON() : v;
          }
          return out;
        },
      }.toJSON;
      swap(proto, 'toJSON', { ...t, value: native(toJSON, 'toJSON') });
    }
  };
  wrapProto(GeolocationCoordinates.prototype);
  wrapProto(GeolocationPosition.prototype);
  const fake = (proto, fields) => {
    const o = Object.create(proto);
    data.set(o, fields);
    return o;
  };
  const make = () => {
    const p = s.pos;
    const coords = fake(GeolocationCoordinates.prototype, {
      latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    });
    return fake(GeolocationPosition.prototype, { coords, timestamp: Date.now() });
  };

  // The same checks, in the same order and words, as Blink's bindings.
  const check = (self, name, args, callbacks) => {
    if (self !== geo) throw new TypeError('Illegal invocation');
    const fail = (why) => new TypeError("Failed to execute '" + name + "' on 'Geolocation': " + why);
    if (args.length < 1) throw fail('1 argument required, but only 0 present.');
    if (!callbacks) return;
    if (typeof args[0] !== 'function') throw fail('The callback provided as parameter 1 is not a function.');
    if (args[1] != null && typeof args[1] !== 'function') throw fail('The callback provided as parameter 2 is not a function.');
  };
  const methods = {
    getCurrentPosition(successCallback) {
      if (this === TOKEN) return s;
      check(this, 'getCurrentPosition', arguments, true);
      later(() => successCallback(make()), 0);
    },
    watchPosition(successCallback) {
      check(this, 'watchPosition', arguments, true);
      let id;
      // Chrome draws watch ids from the timer sequence, so a timer id is the realistic one.
      const timer = later(() => {
        if (s.watches.get(id) === successCallback) successCallback(make());
      }, 0);
      id = typeof timer === 'number' ? timer : s.next++;
      s.watches.set(id, successCallback);
      return id;
    },
    clearWatch(watchId) {
      check(this, 'clearWatch', arguments, false);
      s.watches.delete(watchId | 0);
    },
  };
  for (const k of Object.keys(methods)) swap(G, k, { ...desc(G, k), value: native(methods[k], k) });

  s = {
    token: TOKEN,
    pos,
    watches: new Map(),
    next: 1,
    notify() {
      for (const [id, cb] of s.watches) later(() => { if (s.watches.get(id) === cb) cb(make()); }, 0);
    },
    restore() {
      for (const [obj, key, d] of saved.reverse()) {
        if (d) define(obj, key, d);
        else delete obj[key];
      }
      s.watches.clear();
    },
  };
})()`
}
