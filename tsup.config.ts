import { defineConfig } from 'tsup'

// Bundle ONLY our own source. React and every backend SDK stay external so the
// consumer's copies are used (no duplicate React, no bundled firebase/supabase).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    supabase: 'src/adapters/supabase.ts',
    firebase: 'src/adapters/firebase.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'es2020',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'lucide-react',
    'modern-screenshot',
    '@supabase/supabase-js',
    'firebase',
    /^firebase\//,
  ],
})
