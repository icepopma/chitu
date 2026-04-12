/**
 * env-diff 单元测试 — 回合间环境差异检测
 *
 * 测试覆盖：
 * 1. 快照捕获
 * 2. 差异比较（相同 / 部分变化 / 全部变化）
 * 3. Delta 格式化（XML 格式验证）
 * 4. 完整上下文格式化
 */

import { describe, it, expect } from 'vitest'
import {
  captureEnvSnapshot,
  diffEnvSnapshots,
  formatEnvDelta,
  formatFullEnvContext,
  type EnvSnapshot,
} from './env-diff.js'

describe('env-diff', () => {
  describe('captureEnvSnapshot', () => {
    it('should capture current environment', () => {
      const snapshot = captureEnvSnapshot()
      expect(snapshot.cwd).toBe(process.cwd())
      expect(snapshot.shell).toBe(process.env.SHELL || '/bin/bash')
      expect(snapshot.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(snapshot.platform).toBe(process.platform)
    })

    it('should accept custom cwd', () => {
      const snapshot = captureEnvSnapshot('/custom/path')
      expect(snapshot.cwd).toBe('/custom/path')
    })
  })

  describe('diffEnvSnapshots', () => {
    const base: EnvSnapshot = {
      cwd: '/project',
      shell: '/bin/bash',
      currentDate: '2026-04-12',
      platform: 'darwin',
    }

    it('should return null when snapshots are identical', () => {
      const diff = diffEnvSnapshots(base, { ...base })
      expect(diff).toBeNull()
    })

    it('should detect cwd change', () => {
      const after = { ...base, cwd: '/project/src' }
      const diff = diffEnvSnapshots(base, after)
      expect(diff).toEqual({ cwd: '/project/src' })
    })

    it('should detect multiple changes', () => {
      const after = { ...base, cwd: '/new', currentDate: '2026-04-13' }
      const diff = diffEnvSnapshots(base, after)
      expect(diff).toEqual({ cwd: '/new', currentDate: '2026-04-13' })
    })

    it('should detect all fields changing', () => {
      const after: EnvSnapshot = {
        cwd: '/new',
        shell: '/bin/zsh',
        currentDate: '2026-04-13',
        platform: 'linux',
      }
      const diff = diffEnvSnapshots(base, after)
      expect(diff).toEqual(after)
    })

    it('should ignore unchanged fields', () => {
      const after = { ...base, shell: '/bin/zsh' }
      const diff = diffEnvSnapshots(base, after)
      expect(diff).not.toHaveProperty('cwd')
      expect(diff).not.toHaveProperty('currentDate')
      expect(diff).not.toHaveProperty('platform')
    })
  })

  describe('formatEnvDelta', () => {
    it('should format single field delta', () => {
      const result = formatEnvDelta({ cwd: '/new/path' })
      expect(result).toContain('<environment_context_update>')
      expect(result).toContain('<cwd>/new/path</cwd>')
      expect(result).toContain('</environment_context_update>')
    })

    it('should format multiple fields delta', () => {
      const result = formatEnvDelta({ cwd: '/new', currentDate: '2026-04-13' })
      expect(result).toContain('<cwd>/new</cwd>')
      expect(result).toContain('<current_date>2026-04-13</current_date>')
    })

    it('should XML-escape special characters', () => {
      const result = formatEnvDelta({ cwd: '/path/with <special> & chars' })
      expect(result).toContain('&lt;special&gt;')
      expect(result).toContain('&amp;')
    })
  })

  describe('formatFullEnvContext', () => {
    it('should format complete environment context', () => {
      const snapshot: EnvSnapshot = {
        cwd: '/project',
        shell: '/bin/bash',
        currentDate: '2026-04-12',
        platform: 'darwin',
      }
      const result = formatFullEnvContext(snapshot)
      expect(result).toContain('<environment_context>')
      expect(result).toContain('<cwd>/project</cwd>')
      expect(result).toContain('<shell>/bin/bash</shell>')
      expect(result).toContain('<current_date>2026-04-12</current_date>')
      expect(result).toContain('<platform>darwin</platform>')
      expect(result).toContain('</environment_context>')
    })

    it('should XML-escape values', () => {
      const snapshot: EnvSnapshot = {
        cwd: '/path & more',
        shell: '/bin/bash',
        currentDate: '2026-04-12',
        platform: 'darwin',
      }
      const result = formatFullEnvContext(snapshot)
      expect(result).toContain('&amp;')
    })
  })
})
