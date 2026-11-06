// next.config.ts
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist({
  reactStrictMode: true,
  output: 'standalone',            // imagen Docker liviana
});
