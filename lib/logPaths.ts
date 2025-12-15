import path from 'path'

const defaultLogsDir = path.join(process.cwd(), 'logs')
const fallbackTmpDir = process.env.LOGS_FALLBACK_DIR || '/tmp/solforge-logs'

/**
 * Preferred and fallback locations for logs.
 * - primary: project root /logs (or LOGS_DIR override)
 * - fallback: tmp directory safe for serverless (or LOGS_FALLBACK_DIR override)
 */
export const getLogDirs = () => ({
  primary: process.env.LOGS_DIR || defaultLogsDir,
  fallback: fallbackTmpDir,
})

export const shouldFallbackToTmp = (error: any) => {
  const code = error?.code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
}
