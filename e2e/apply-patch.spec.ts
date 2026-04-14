// Step 14.1 Apply Patch — Playwright E2E Test
// 测试 apply_patch 工具的端到端流程：
// 1. Agent 能使用 apply_patch 创建新文件
// 2. Agent 能使用 apply_patch 修改已有文件
// 3. 前端正确显示工具调用和结果
//
// 前置条件：后端和前端已启动

import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

test.setTimeout(180_000)

const TEST_DIR = '/tmp/chitu-apply-patch-e2e'

/** 等待 Turn 完成 */
async function waitForTurnComplete(page: Page, timeout = 150_000): Promise<void> {
  await page.waitForFunction(() => {
    const statusEl = document.querySelector('.text-xs.text-\\[\\#43b581\\]')
    if (statusEl && statusEl.textContent?.includes('已完成')) return true

    const failedEl = document.querySelector('.text-xs.text-\\[\\#da373c\\]')
    if (failedEl) return true

    const labels = document.querySelectorAll('span.text-sm.font-medium.text-white')
    let chituCount = 0
    for (const label of labels) {
      if (label.textContent === '赤兔') chituCount++
    }
    if (chituCount >= 1) return true

    return false
  }, { timeout })
}

/** 发送消息 */
async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('textarea')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(message)
  await input.press('Enter')
}

/** 创建新对话 */
async function createNewThread(page: Page): Promise<void> {
  const newBtn = page.locator('button').filter({ hasText: '新建' }).first()
  await newBtn.click()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
}

test.describe('Apply Patch E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 准备测试目录
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })

    // 创建一个已有的文件供修改
    writeFileSync(join(TEST_DIR, 'hello.ts'), [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}!`',
      '}',
      '',
      'export function farewell(name: string): string {',
      '  return `Goodbye, ${name}!`',
      '}',
      '',
    ].join('\n'))

    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test.afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test('should create new file via apply_patch', async ({ page }) => {
    await createNewThread(page)

    const task = `请在 ${TEST_DIR} 目录下使用 apply_patch 工具创建一个新文件 utils.ts，内容如下：
- 一个 add(a, b) 函数
- 一个 multiply(a, b) 函数
都返回 number。用 *** Begin Patch / *** Add File 格式。`

    await sendMessage(page, task)
    await waitForTurnComplete(page, 150_000)
    await page.screenshot({ path: 'test-results/apply-patch-create.png' })

    // 验证文件被创建
    expect(existsSync(join(TEST_DIR, 'utils.ts'))).toBe(true)
    const content = readFileSync(join(TEST_DIR, 'utils.ts'), 'utf-8')
    expect(content).toContain('add')
    expect(content).toContain('multiply')

    // 验证前端显示了 Agent 回复
    const agentLabel = page.locator('span.text-sm.font-medium.text-white', { hasText: '赤兔' })
    await expect(agentLabel.first()).toBeVisible({ timeout: 5_000 })

    console.log('[e2e] Create file test passed — utils.ts:', content.slice(0, 200))
  })

  test('should modify existing file via apply_patch', async ({ page }) => {
    await createNewThread(page)

    const task = `请使用 apply_patch 工具修改 ${TEST_DIR}/hello.ts 文件，把 greet 函数的返回值从 "Hello" 改为 "Hi"。使用 *** Begin Patch / *** Update File 格式，包含上下文行帮助定位。`

    await sendMessage(page, task)
    await waitForTurnComplete(page, 150_000)
    await page.screenshot({ path: 'test-results/apply-patch-update.png' })

    // 验证文件被修改
    const content = readFileSync(join(TEST_DIR, 'hello.ts'), 'utf-8')
    expect(content).toContain('Hi')
    expect(content).not.toContain('Hello,')
    // farewell 函数应该保持不变
    expect(content).toContain('Goodbye')

    console.log('[e2e] Update file test passed — hello.ts:', content.slice(0, 200))
  })

  test('should handle multiple hunks in one patch', async ({ page }) => {
    await createNewThread(page)

    const task = `请使用 apply_patch 工具修改 ${TEST_DIR}/hello.ts 文件，做两个修改：
1. 把 greet 函数返回值从 "Hello" 改为 "Hey"
2. 把 farewell 函数返回值从 "Goodbye" 改为 "See you"
在一个 apply_patch 调用中完成（使用两个 @@ 块）。`

    await sendMessage(page, task)
    await waitForTurnComplete(page, 150_000)
    await page.screenshot({ path: 'test-results/apply-patch-multi-hunk.png' })

    const content = readFileSync(join(TEST_DIR, 'hello.ts'), 'utf-8')
    expect(content).toContain('Hey')
    expect(content).toContain('See you')
    expect(content).not.toContain('Hello,')
    expect(content).not.toContain('Goodbye')

    console.log('[e2e] Multi-hunk test passed — hello.ts:', content.slice(0, 300))
  })
})
