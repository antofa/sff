import path from 'path'

const isNetlify =
  process.env.NETLIFY === 'true' ||
  process.env.NETLIFY === '1' ||
  Boolean(process.env.DEPLOY_PRIME_URL) ||
  Boolean(process.env.CONTEXT)

const defaultLogsDir = isNetlify ? '/tmp/sff-logs' : path.join(process.cwd(), 'logs')
const fallbackTmpDir = process.env.LOGS_FALLBACK_DIR || '/tmp/sff-logs'

/**
 * Preferred and fallback locations for logs.
 * - primary: /tmp on Netlify, otherwise project root /logs (or LOGS_DIR override)
 * - fallback: /tmp (or LOGS_FALLBACK_DIR override)
 */
export const getLogDirs = () => ({
  primary: process.env.LOGS_DIR || defaultLogsDir,
  fallback: fallbackTmpDir,
})

export const shouldFallbackToTmp = (error: any) => {
  const code = error?.code
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
}
