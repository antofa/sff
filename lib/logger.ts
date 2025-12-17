import { isConsoleTimestampInstalled } from './consoleTimestamp'

export const logWithTimestamp = (...args: unknown[]) => {
  if (isConsoleTimestampInstalled()) {
    console.log(...args)
    return
  }

  const timestamp = new Date().toISOString()
  if (typeof args[0] === 'string') {
    console.log(`[${timestamp}] ${args[0]}`, ...args.slice(1))
    return
  }
  console.log(`[${timestamp}]`, ...args)
}
