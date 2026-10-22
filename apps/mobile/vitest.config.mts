import { defineConfig } from 'vitest/config'

// Pure logic only (src/lib); screens and native modules are exercised on the device.
export default defineConfig({ test: { include: ['src/lib/**/*.test.ts'] } })
