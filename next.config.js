/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

