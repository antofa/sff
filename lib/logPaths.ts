import path from 'path'

/**
 * Returns a writable directory for logs. On serverless platforms like Netlify
 * the application directory is read-only, so we fall back to /tmp.
 */
export const getWritableLogsDir = () => {
  if (process.env.LOGS_DIR) return process.env.LOGS_DIR
  const isReadOnlyFs = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT)
  return isReadOnlyFs ? '/tmp/solforge-logs' : path.join(process.cwd(), 'logs')
}
