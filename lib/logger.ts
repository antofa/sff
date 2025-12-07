export const logWithTimestamp = (...args: unknown[]) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}]`, ...args)
}
