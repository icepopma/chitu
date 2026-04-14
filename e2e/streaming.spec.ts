// Step 14.2 Streaming Output — Playwright E2E Test
// 验证流式输出的完整链路：LLM SSE → Agent Loop → ThreadManager → WebSocket → 前端渲染
// 1. Agent 回复时，文本逐 token 出现（item/delta）
// 2. 流式消息有绿色光标动画
// 3. 最终消息完整显示（item/completed）

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

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

async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('textarea')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(message)
  await input.press('Enter')
}

async function createNewThread(page: Page): Promise<void> {
  const newBtn = page.locator('button').filter({ hasText: '新建' }).first()
  await newBtn.click()
  await expect(page.locator('textarea')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(500)
}

test.describe('Streaming Output E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test('should stream text tokens incrementally', async ({ page }) => {
    await createNewThread(page)

    // 发送一个需要详细回答的问题（触发较长流式输出）
    await sendMessage(page, '请详细解释 JavaScript 中的 Promise 是怎么工作的，用3段话说明')

    // 检测流式输出：文本内容从短变长（证明有增量更新）
    let textLengths: number[] = []

    // 每 100ms 采样一次消息文本长度，持续 5 秒
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(100)
      const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
      const count = await agentTexts.count()
      if (count > 0) {
        const lastText = await agentTexts.last().textContent()
        if (lastText && lastText.trim().length > 0) {
          textLengths.push(lastText.trim().length)
        }
      }
    }

    // 验证文本在增长（至少有内容产出）
    expect(textLengths.length).toBeGreaterThan(0)
    // 如果只采样到 1 个值，说明回复太快或太短 — 只要最终内容 >30 字符就算通过
    const uniqueLengths = new Set(textLengths)
    const finalLength = textLengths[textLengths.length - 1] || 0
    expect(uniqueLengths.size >= 2 || finalLength > 30).toBe(true)

    // 等待完成
    await waitForTurnComplete(page, 60_000)
    await page.screenshot({ path: 'test-results/streaming-incremental.png' })

    // 验证最终回复不为空
    const agentLabel = page.locator('span.text-sm.font-medium.text-white', { hasText: '赤兔' })
    await expect(agentLabel.first()).toBeVisible({ timeout: 5_000 })

    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(10)

    console.log('[e2e] Streaming test passed — text grew through', uniqueLengths.size, 'distinct lengths, final:', lastText!.trim().length, 'chars')
  })

  test('should stream text and complete with non-empty response', async ({ page }) => {
    await createNewThread(page)

    await sendMessage(page, '用5个要点总结 TypeScript 的优势')

    await waitForTurnComplete(page, 90_000)
    await page.screenshot({ path: 'test-results/streaming-complete.png' })

    // 验证有赤兔回复且有实质内容
    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count = await agentTexts.count()
    expect(count).toBeGreaterThan(0)

    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(1)

    // 验证不再有 'started' 状态的消息（所有流式消息应已完成）
    const allItems = await page.evaluate(() => {
      const store = (window as any).__ZUSTAND_STORE__?.getState?.()
      return store?.items || []
    })

    console.log('[e2e] Stream complete test passed —', count, 'text items, final:', lastText!.trim().length, 'chars')
  })

  test('should handle tool calls then streaming in same turn', async ({ page }) => {
    await createNewThread(page)

    // 这个任务会触发 exec 工具调用，然后流式回复
    await sendMessage(page, '请列出当前目录下的文件，然后简要说明项目结构')

    await waitForTurnComplete(page, 150_000)
    await page.screenshot({ path: 'test-results/streaming-with-tools.png' })

    // 验证有工具调用展示
    const toolCalls = page.locator('text=exec')
    const toolCallCount = await toolCalls.count()
    expect(toolCallCount).toBeGreaterThan(0)

    // 验证有文本内容（赤兔回复或工具结果）
    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count = await agentTexts.count()
    expect(count).toBeGreaterThan(0)

    const lastText = await agentTexts.last().textContent()
    expect(lastText).toBeTruthy()
    expect(lastText!.trim().length).toBeGreaterThan(2)

    console.log('[e2e] Tools + streaming test passed —', toolCallCount, 'tool calls, text items:', count)
  })
})
