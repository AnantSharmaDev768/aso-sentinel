import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The dashboard imports the shared scenario engine (../shared) and committed Sepolia evidence
// (../deployments), so the dev server may read the repository root.
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] }, port: 5173, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        // Separate long-lived vendor chunks (the chain client is the largest dependency).
        codeSplitting: {
          groups: [
            { name: 'chain', test: /node_modules[\\/](viem|ox|abitype|@noble|@scure|@adraffy)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            // committed validation results (data, not code): one chunk per rule set
            { name: 'validation-baseline', test: /validation[\\/]baseline[\\/].*\.json$/ },
            { name: 'validation-candidate', test: /validation[\\/]candidate-graded[\\/].*\.json$/ },
            { name: 'validation-final', test: /validation[\\/]final[\\/].*\.json$/ },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
