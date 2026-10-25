import { createContext } from 'react'
import { SettingsActions } from './settings-manager'

const disconnected = () => Promise.reject(new Error('Emacs is not connected.'))
export const SettingsContext = createContext<SettingsActions>({ connected: false, save: disconnected, restore: disconnected })
