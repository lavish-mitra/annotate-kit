import { defineConfig } from 'tsup'

// React and every backend SDK stay external so the consumer's copies are used
// (no duplicate React, no bundled firebase/supabase).
const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'lucide-react',
  'modern-screenshot',
  '@supabase/supabase-js',
  'firebase',
  /^firebase\//,
]

export default defineConfig([
  {
    // Client entry — the React overlay needs a "use client" directive first in the file.
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    banner: { js: '"use client";' },
    dts: true,
    clean: true,
    sourcemap: false,
    target: 'es2020',
    external,
  },
  {
    // Backend adapters + pure logic — NO "use client", so they import cleanly into React Server
    // Components and Node server code. (prompt/delivery are also re-exported from the client index.)
    entry: {
      supabase: 'src/adapters/supabase.ts',
      firebase: 'src/adapters/firebase.ts',
      local: 'src/adapters/local.ts',
      rest: 'src/adapters/rest.ts',
      idb: 'src/adapters/idb.ts',
      prompt: 'src/prompt.ts',
      delivery: 'src/delivery.ts',
    },
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: false,
    target: 'es2020',
    external,
  },
])
