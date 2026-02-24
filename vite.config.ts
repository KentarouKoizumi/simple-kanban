import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const isGithubIoRepository = repositoryName.endsWith('.github.io')
const githubPagesBase =
  process.env.GITHUB_ACTIONS === 'true'
    ? isGithubIoRepository
      ? '/'
      : `/${repositoryName}/`
    : '/'

export default defineConfig({
  base: githubPagesBase,
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
})
