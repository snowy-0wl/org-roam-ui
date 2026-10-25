import {
  initialPhysics,
  initialFilter,
  initialVisuals,
  initialBehavior,
  initialMouse,
  initialLocal,
  initialColoring,
} from '../components/config'
import { themes } from '../components/themes'
import schema from '../settings-schema.json'

export const SETTINGS_CHANGED_EVENT = 'org-roam-ui-settings-changed'

export interface Preferences {
  '3d': boolean
  tagCols: Record<string, string>
  colorTheme: [string, Record<string, string>]
  highlightColor: string
  sidebarWidth: number
  mainWindowWidth: number
  showTweaks: boolean
  justification: number
  outline: boolean
  physics: typeof initialPhysics
  filter: Omit<typeof initialFilter, 'nodes' | 'links' | 'date'>
  visuals: Omit<typeof initialVisuals, 'algorithmOptions'>
  behavior: typeof initialBehavior
  mouse: typeof initialMouse
  local: typeof initialLocal
  coloring: typeof initialColoring
}

export interface SettingsDocument {
  version: 1
  preferences: Preferences
}

export interface SettingsActions {
  connected: boolean
  save: () => Promise<string>
  restore: () => Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validate(value: unknown, specification: unknown, path: string): void {
  const fail = () => { throw new Error(`Invalid settings at ${path}`) }
  if (specification === 'boolean') {
    if (typeof value !== 'boolean') fail()
  } else if (specification === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail()
  } else if (specification === 'string') {
    if (typeof value !== 'string' || value.length > 4096) fail()
  } else if (Array.isArray(specification)) {
    if (!Array.isArray(value) || value.length > 1000) return fail()
    if (specification.length !== 1 && value.length !== specification.length) fail()
    value.forEach((item, index) => validate(item, specification.length === 1 ? specification[0] : specification[index], `${path}[${index}]`))
  } else if (isRecord(specification) && Array.isArray(specification.enum)) {
    if (!specification.enum.includes(value)) fail()
  } else if (isRecord(specification)) {
    if (!isRecord(value)) return fail()
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail()
      const child = specification['*'] ?? specification[key]
      if (child === undefined) fail()
      validate(item, child, `${path}.${key}`)
    }
  } else {
    fail()
  }
}

export function getDefaultSettings(): SettingsDocument {
  const { nodes, links, date, ...filter } = initialFilter
  const { algorithmOptions, ...visuals } = initialVisuals
  return {
    version: 1,
    preferences: {
      '3d': false,
      tagCols: {},
      colorTheme: ['one-vibrant', { ...themes['one-vibrant'] }],
      highlightColor: 'purple.500',
      sidebarWidth: 400,
      mainWindowWidth: 800,
      showTweaks: false,
      justification: 1,
      outline: false,
      physics: { ...initialPhysics }, filter, visuals,
      behavior: { ...initialBehavior }, mouse: { ...initialMouse },
      local: { ...initialLocal }, coloring: { ...initialColoring },
    },
  }
}

function mergeDefaults(defaults: unknown, value: unknown): unknown {
  if (!isRecord(defaults) || !isRecord(value)) return value === undefined ? defaults : value
  if (Object.keys(defaults).length === 0) return value
  return Object.fromEntries(Object.entries(defaults).map(([key, defaultValue]) => [key, mergeDefaults(defaultValue, value[key])]))
}

export function parseSettings(value: unknown): SettingsDocument {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.preferences) ||
      Object.keys(value).some((key) => !['version', 'preferences'].includes(key))) {
    throw new Error('Unsupported settings document; expected version 1 and preferences')
  }
  validate(value.preferences, schema.preferences, 'preferences')
  const defaults = getDefaultSettings()
  const preferences = mergeDefaults(defaults.preferences, value.preferences)
  // The shared schema validates every supplied field; missing fields use canonical defaults.
  const result = { version: 1, preferences } as SettingsDocument
  result.preferences.colorTheme = [result.preferences.colorTheme[0], {
    ...defaults.preferences.colorTheme[1], ...result.preferences.colorTheme[1],
  }]
  return result
}

function selectKnown(value: unknown, specification: unknown): unknown {
  if (!isRecord(value) || !isRecord(specification) || specification['*'] || specification.enum) return value
  return Object.fromEntries(Object.entries(specification)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(value, key))
    .map(([key, child]) => [key, selectKnown(value[key], child)]))
}

export function collectSettings(storage: Storage): SettingsDocument {
  const preferences = Object.fromEntries(Object.entries(schema.preferences).flatMap(([key, specification]) => {
    const raw = storage.getItem(key)
    if (raw === null || raw === 'undefined') return []
    return [[key, selectKnown(JSON.parse(raw), specification)]]
  }))
  return parseSettings({ version: 1, preferences })
}

export function applySettings(value: unknown, storage: Storage, notify: () => void): void {
  const settings = parseSettings(value)
  const changes = Object.entries(settings.preferences).map(([key, preference]): [string, string] => [key, JSON.stringify(preference)])
  const previous = changes.map(([key]): [string, string | null] => [key, storage.getItem(key)])
  try {
    changes.forEach(([key, preference]) => storage.setItem(key, preference))
  } catch (error) {
    changes.forEach(([key]) => storage.removeItem(key))
    previous.forEach(([key, preference]) => {
      if (preference === null) storage.removeItem(key)
      else storage.setItem(key, preference)
    })
    throw error
  }
  notify()
}

interface SettingsSocket {
  readyState: number
  send: (data: string) => void
}

type Pending = { resolve: (message: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export function createSettingsClient(
  socket: SettingsSocket,
  storage: Storage,
  notify: () => void,
  options: { timeout?: number; onError?: (message: string) => void } = {},
) {
  const timeout = options.timeout ?? 10000
  let loadSaved = true
  const pending = new Map<string, Pending>()
  let sequence = 0
  const send = (command: string, data: object) => {
    if (socket.readyState !== 1) throw new Error('Emacs is disconnected. Reconnect before saving or restoring settings.')
    socket.send(JSON.stringify({ command, data }))
  }
  const request = (operation: 'save' | 'restore'): Promise<string> => {
    if (socket.readyState !== 1) return Promise.reject(new Error('Emacs is disconnected. Reconnect before saving or restoring settings.'))
    const requestId = `browser-${Date.now()}-${++sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('Emacs did not acknowledge the settings request. Check the connection and *Messages*.'))
      }, timeout)
      pending.set(requestId, { resolve, reject, timer })
      try {
        send(`settings-${operation}`, { requestId, ...(operation === 'save' ? { settings: collectSettings(storage) } : {}) })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error instanceof Error ? error : new Error('Settings request failed'))
      }
    })
  }
  return {
    save: () => request('save'),
    restore: () => request('restore'),
    ready: () => {
      send('settings-ready', { loadSaved })
      loadSaved = false
    },
    disconnect: () => {
      pending.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error('Emacs disconnected before the settings request completed.')) })
      pending.clear()
    },
    handleMessage: (message: unknown): boolean => {
      if (!isRecord(message) || typeof message.type !== 'string' || !message.type.startsWith('settings-')) return false
      if (!isRecord(message.data) || typeof message.data.requestId !== 'string') return true
      const { requestId } = message.data
      if (message.type === 'settings-result') {
        const request = pending.get(requestId)
        if (request) {
          clearTimeout(request.timer)
          pending.delete(requestId)
          if (message.data.ok === true) request.resolve(typeof message.data.message === 'string' ? message.data.message : 'Settings updated')
          else request.reject(new Error(typeof message.data.error === 'string' ? message.data.error : 'Settings request failed'))
        } else if (message.data.ok !== true) {
          options.onError?.(typeof message.data.error === 'string' ? message.data.error : 'Could not load saved settings')
        }
      } else if (message.type === 'settings-snapshot-request') {
        try { send('settings-snapshot', { requestId, settings: collectSettings(storage) }) }
        catch (error) { send('settings-failed', { requestId, error: error instanceof Error ? error.message : 'Could not read browser settings' }) }
      } else if (message.type === 'settings-apply') {
        try {
          applySettings(message.data.settings, storage, notify)
          send('settings-applied', { requestId, ok: true })
        } catch (error) {
          send('settings-applied', { requestId, ok: false, error: error instanceof Error ? error.message : 'Could not apply settings' })
        }
      }
      return true
    },
  }
}
