import { useState, useEffect, useRef } from 'react'
import { SETTINGS_CHANGED_EVENT } from './settings-manager'

export function usePersistantState<V>(
  storageKey: string,
  defaultValue: V,
  options: { storage?: Storage } = {},
): [V, (v: V | ((v: V) => V)) => void] {
  const source = options.storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
  const defaults = useRef(defaultValue)
  defaults.current = defaultValue
  const read = () => {
    const stored = source ? getStorage<V | undefined>(storageKey, source).get() : undefined
    if (stored == null) return defaults.current
    return typeof stored === 'object' && !Array.isArray(stored)
      ? { ...defaults.current, ...stored }
      : stored
  }
  const [value, setValue] = useState<V>(() => defaultValue)
  useEffect(() => {
    const synchronize = () => setValue(read())
    synchronize()
    window.addEventListener(SETTINGS_CHANGED_EVENT, synchronize)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, synchronize)
  }, [storageKey, source])
  const set = (newValueOrFn: V | ((v: V) => V)) => {
    setValue((oldValue) => {
      const newValue = newValueOrFn instanceof Function ? newValueOrFn(oldValue) : newValueOrFn
      if (source) getStorage<V>(storageKey, source).update(newValue)
      return newValue
    })
  }
  return [value, set]
}

export function getStorage<T>(key: string, storage: Storage) {
  return {
    get(): T | undefined {
      const value = storage.getItem(key)
      if (!value || value === 'undefined') return undefined
      try { return JSON.parse(value) }
      catch { return undefined }
    },
    update(updatedState: T) { storage.setItem(key, JSON.stringify(updatedState)) },
    remove() { storage.removeItem(key) },
  }
}
