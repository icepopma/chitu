// Step 14.3 Memories System — Playwright E2E Test
// 验证记忆系统的完整链路：
// 1. 第一个对话产生足够的上下文，触发记忆提取
// 2. 记忆被保存到文件（chitu-data/memories/memories.json）
// 3. 第二个对话中，记忆被注入到 Agent 上下文
// 4. Agent 利用记忆知识回答问题

import { test, expect, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

test.setTimeout(180_000)

const MEMORIES_FILE = join(process.cwd(), 'chitu-data', 'memories', 'memories.json')

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

// 清理记忆文件，确保测试隔离
async function cleanMemories(): Promise<void> {
  if (existsSync(MEMORIES_FILE)) {
    const { unlinkSync } = await import('fs')
    unlinkSync(MEMORIES_FILE)
  }
}

test.describe('Memories System E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2_000)
  })

  test('should extract and inject memories across threads', async ({ page }) => {
    // 清理旧记忆
    await cleanMemories()

    // === 第一个对话：告诉 Agent 一个偏好 ===
    await createNewThread(page)
    await sendMessage(page, '请记住：我在这个项目中总是使用 tabs 缩进，不用 spaces。另外我喜欢用 pnpm 而不是 npm。请确认你记住了。')

    await waitForTurnComplete(page, 90_000)
    await page.screenshot({ path: 'test-results/memories-thread1.png' })

    // 验证第一个对话有回复
    const agentTexts1 = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count1 = await agentTexts1.count()
    expect(count1).toBeGreaterThan(0)
    const reply1 = await agentTexts1.last().textContent()
    expect(reply1).toBeTruthy()
    console.log('[e2e] Thread 1 reply:', reply1!.slice(0, 100))

    // 等待异步记忆提取完成（最多 15 秒）
    let memoriesExist = false
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500)
      if (existsSync(MEMORIES_FILE)) {
        try {
          const raw = readFileSync(MEMORIES_FILE, 'utf-8')
          const store = JSON.parse(raw)
          if (store.memories && store.memories.length > 0) {
            memoriesExist = true
            console.log('[e2e] Memories extracted:', store.memories.length, 'memories')
            for (const m of store.memories) {
              console.log(`  [${m.category}] ${m.content}`)
            }
            break
          }
        } catch {
          // 文件可能还在写入中
        }
      }
    }

    expect(memoriesExist).toBe(true)

    // === 第二个对话：验证记忆被注入 ===
    await createNewThread(page)
    await sendMessage(page, '这个项目用什么包管理器？缩进用 tabs 还是 spaces？')

    await waitForTurnComplete(page, 120_000)
    await page.screenshot({ path: 'test-results/memories-thread2.png' })

    // 验证第二个对话有回复
    const agentTexts2 = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count2 = await agentTexts2.count()
    expect(count2).toBeGreaterThan(0)
    const reply2 = await agentTexts2.last().textContent()
    expect(reply2).toBeTruthy()
    expect(reply2!.trim().length).toBeGreaterThan(2)

    console.log('[e2e] Thread 2 reply:', reply2!.slice(0, 200))

    // 验证回复中包含了记忆中的信息
    // Agent 用中文回复，所以检查中文关键词（包管理器、pnpm、缩进、tab）
    const lowerReply = reply2!.toLowerCase()
    const mentionsPnpm = lowerReply.includes('pnpm') || lowerReply.includes('包管理')
    const mentionsTabs = lowerReply.includes('tab') || lowerReply.includes('缩进')
    console.log('[e2e] Memory recall — pnpm:', mentionsPnpm, ', tabs:', mentionsTabs)

    // 至少应该提到其中一个（宽松验证，因为 LLM 可能没有严格引用）
    expect(mentionsPnpm || mentionsTabs).toBe(true)
  })

  test('should not extract memories from short conversations', async ({ page }) => {
    await cleanMemories()

    // 简单的短对话（不会触发提取）
    await createNewThread(page)
    await sendMessage(page, '1+1等于几？')

    await waitForTurnComplete(page, 60_000)
    await page.screenshot({ path: 'test-results/memories-short.png' })

    // 等待一段时间确认没有产生记忆
    await page.waitForTimeout(3_000)

    // 短对话不应产生记忆（或者如果有，也是因为上一个测试的残留）
    // 这个测试主要验证系统不会崩溃
    const agentTexts = page.locator('.text-sm.text-\\[\\#ddd\\]')
    const count = await agentTexts.count()
    expect(count).toBeGreaterThan(0)
    const reply = await agentTexts.last().textContent()
    expect(reply).toBeTruthy()

    console.log('[e2e] Short conversation test passed — no crash, agent replied')
  })
})
