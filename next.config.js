/** @type {import('next').NextConfig} */
const installConsoleTimestamp = () => {
  const flag = '__sffConsoleTimestampInstalled__'
  if (globalThis[flag]) return

  const methods = ['log', 'info', 'warn', 'error', 'debug']
  methods.forEach((method) => {
    const original = console[method].bind(console)
    console[method] = (...args) => {
      const timestamp = new Date().toISOString()
      if (typeof args[0] === 'string') {
        original(`[${timestamp}] ${args[0]}`, ...args.slice(1))
      } else {
        original(`[${timestamp}]`, ...args)
      }
    }
  })

  globalThis[flag] = true
}

const installStreamTimestamp = () => {
  const flag = '__sffStreamTimestampInstalled__'
  if (globalThis[flag]) return

  const timestampPattern = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/
  const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '')

  const wrapStream = (stream) => {
    if (!stream || typeof stream.write !== 'function') return
    const originalWrite = stream.write.bind(stream)
    let buffer = ''

    stream.write = (chunk, encoding, callback) => {
      let enc = encoding
      let cb = callback
      if (typeof enc === 'function') {
        cb = enc
        enc = undefined
      }

      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk && typeof chunk.toString === 'function'
            ? chunk.toString(enc || 'utf8')
            : String(chunk)

      const combined = buffer + text
      const parts = combined.split(/\r\n|\n|\r/)
      buffer = parts.pop() ?? ''
      const lines = parts.map((line) => {
        const trimmed = line.replace(/^\s+/, '')
        const cleaned = stripAnsi(trimmed)
        if (!cleaned) return line
        if (timestampPattern.test(cleaned)) return line
        const timestamp = new Date().toISOString()
        return `[${timestamp}] ${trimmed}`
      })

      if (lines.length > 0) {
        const output = `${lines.join('\n')}\n`
        return originalWrite(output, enc, cb)
      }

      if (cb) cb()
      return true
    }
  }

  wrapStream(process.stdout)
  wrapStream(process.stderr)
  globalThis[flag] = true
}

installStreamTimestamp()
installConsoleTimestamp()

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/images/logo/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400',
          },
        ],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'solforgefusion.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.solforgefusion.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '**.solforgefusion.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'sfwmedia11453-main.s3.amazonaws.com',
        pathname: '/**',
      },
    ],
    unoptimized: false,
  },
}

module.exports = nextConfig
