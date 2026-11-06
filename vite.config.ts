/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// SINGLE=1: 크롬에서 더블클릭으로 여는 HTML 한 파일(담임업무.html)로 빌드한다.
const single = process.env.SINGLE === '1'

export default defineConfig({
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: single ? { outDir: 'dist-single', emptyOutDir: true } : undefined,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
