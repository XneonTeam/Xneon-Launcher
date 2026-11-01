import { ShareError, type SharedLaunchSettings } from './types.js'

const REQUIRED_KEYS = ['javaOverride', 'memoryMin', 'memoryMax', 'javaArgs', 'java', 'windowOverride', 'windowWidth', 'windowHeight', 'account'] as const
export const EXTRA_LAUNCH_SETTING_KEYS = ['serverOverride', 'server', 'serverPort', 'group', 'preLaunchCommand', 'postLaunchCommand', 'wrapperCommand', 'customEnv'] as const
export const LAUNCH_SETTING_KEYS = [...REQUIRED_KEYS, ...EXTRA_LAUNCH_SETTING_KEYS] as const

/** Настройки сборки и описание аккаунта без локальных ID и токенов авторизации. */
export function validateLaunchSettings(input: unknown): SharedLaunchSettings {
  const fail = (): never => { throw new ShareError('SCHEMA', 'Invalid shared launch settings') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
  const value = input as SharedLaunchSettings
  if (REQUIRED_KEYS.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !LAUNCH_SETTING_KEYS.includes(key as typeof LAUNCH_SETTING_KEYS[number]))) return fail()
  if (value.serverOverride !== undefined && typeof value.serverOverride !== 'boolean') return fail()
  for (const key of EXTRA_LAUNCH_SETTING_KEYS) if (key !== 'serverOverride' && value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 16384 || value[key].includes('\0'))) return fail()
  if (typeof value.javaOverride !== 'boolean' || typeof value.windowOverride !== 'boolean') return fail()
  for (const memory of [value.memoryMin, value.memoryMax]) if (typeof memory !== 'string' || memory !== '' && !/^[1-9]\d{0,6}[MG]$/i.test(memory)) return fail()
  if (typeof value.javaArgs !== 'string' || value.javaArgs.length > 16384 || value.javaArgs.includes('\0')) return fail()
  for (const size of [value.windowWidth, value.windowHeight]) if (size !== null && (!Number.isInteger(size) || size < 1 || size > 32768)) return fail()
  if (value.java !== null) {
    if (!value.java || typeof value.java !== 'object' || Object.keys(value.java).some(key => !['path', 'major', 'vendor'].includes(key))) return fail()
    if (value.java.path !== undefined && (typeof value.java.path !== 'string' || value.java.path.length > 4096 || /[\x00-\x1f]/.test(value.java.path))) return fail()
    if (value.java.major !== undefined && (!Number.isInteger(value.java.major) || value.java.major < 1 || value.java.major > 200)) return fail()
    if (value.java.vendor !== undefined && (typeof value.java.vendor !== 'string' || value.java.vendor.length > 200)) return fail()
  }
  if (value.account !== null) {
    const account = value.account
    if (!account || typeof account !== 'object' || Object.keys(account).some(key => !['type', 'username', 'uuid', 'serverUrl'].includes(key))) return fail()
    if (!['microsoft', 'elyby', 'xnskins', 'offline', 'authlib-injector'].includes(account.type) || typeof account.username !== 'string' || !account.username.trim() || account.username.length > 100) return fail()
    if (account.uuid !== undefined && (typeof account.uuid !== 'string' || account.uuid.length > 100)) return fail()
    if (account.serverUrl !== undefined && (typeof account.serverUrl !== 'string' || account.serverUrl.length > 2048)) return fail()
  }
  return structuredClone(value)
}
