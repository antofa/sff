type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'

const METHODS: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug']
const FLAG_KEY = '__sffConsoleTimestampInstalled__'

export const isConsoleTimestampInstalled = () => {
  return Boolean((globalThis as Record<string, unknown>)[FLAG_KEY])
}

export const installConsoleTimestamp = () => {
  const globalAny = globalThis as Record<string, unknown>
  if (globalAny[FLAG_KEY]) return

  METHODS.forEach((method) => {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      const timestamp = new Date().toISOString()
      if (typeof args[0] === 'string') {
        original(`[${timestamp}] ${args[0]}`, ...args.slice(1))
      } else {
        original(`[${timestamp}]`, ...args)
      }
    }
  })

  globalAny[FLAG_KEY] = true
}
