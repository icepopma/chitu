import { buildProjectContext, formatAgentsMdInjection, buildEnvironmentContext, findProjectRoot, loadAgentsMd, buildPathChain, loadHierarchicalAgentsMd } from './context.js'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}`)
    failed++
  }
}

// ===== 1. findProjectRoot =====
console.log('\n=== 1. findProjectRoot ===')
const root = findProjectRoot(process.cwd())
console.log('项目根:', root)
assert(root !== null, '能找到项目根')
assert(root === findProjectRoot(root!), '从根目录找根目录一致')

// ===== 2. buildPathChain =====
console.log('\n=== 2. buildPathChain ===')

// 同一目录
const singleChain = buildPathChain('/project', '/project')
assert(singleChain.length === 1, 'root === cwd 时只有一层')
assert(singleChain[0] === '/project', 'root === cwd 时返回 [root]')

// 子目录
const multiChain = buildPathChain('/project', '/project/src/server')
assert(multiChain.length === 3, 'root → src → server 有 3 层')
assert(multiChain[0] === '/project', '第一层是 root')
assert(multiChain[1] === '/project/src', '第二层是 src')
assert(multiChain[2] === '/project/src/server', '第三层是 server')

// CWD 在 root 外
const outsideChain = buildPathChain('/project', '/other')
assert(outsideChain.length === 1, 'CWD 在 root 外只返回 root')
assert(outsideChain[0] === '/project', '返回 projectRoot')

// ===== 3. loadAgentsMd =====
console.log('\n=== 3. loadAgentsMd ===')
if (root) {
  const agentsMd = loadAgentsMd(root)
  assert(agentsMd !== null, '根目录有 AGENTS.md')
  if (agentsMd) {
    console.log('  找到文件:', agentsMd.path)
    console.log('  内容长度:', agentsMd.content.length)
  }
} else {
  console.log('  ⚠️ 跳过（找不到项目根）')
}

// ===== 4. loadHierarchicalAgentsMd — 向后兼容 =====
console.log('\n=== 4. loadHierarchicalAgentsMd — 向后兼容 ===')
if (root) {
  // CWD === root 时，行为和旧版一致
  const single = loadHierarchicalAgentsMd(root, root)
  assert(single !== null, 'root 有 AGENTS.md 时返回非 null')
  assert(single!.includes('# AGENTS.md instructions for'), '包含 header')
  assert(single!.includes('<INSTRUCTIONS>'), '包含 INSTRUCTIONS 标签')

  // 用 buildProjectContext 验证
  const ctx = buildProjectContext()
  assert(ctx.agentsMdMessage !== null, 'buildProjectContext 返回 agentsMdMessage')
  if (ctx.agentsMdMessage) {
    assert(ctx.agentsMdMessage.includes('<INSTRUCTIONS>'), 'context message 包含 INSTRUCTIONS')
  }
}

// ===== 5. loadHierarchicalAgentsMd — 分层收集 =====
console.log('\n=== 5. loadHierarchicalAgentsMd — 分层收集 ===')
const testDir = join(process.cwd(), '.test-hierarchical')
try {
  // 清理旧数据
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(join(testDir, 'src', 'server'), { recursive: true })

  // 创建分层 AGENTS.md
  writeFileSync(join(testDir, 'AGENTS.md'), '# Root\n全局规范：使用 TypeScript')
  writeFileSync(join(testDir, 'src', 'AGENTS.md'), '# Src\nsrc 层规范：所有文件必须 export')
  writeFileSync(join(testDir, 'src', 'server', 'AGENTS.md'), '# Server\nserver 层规范：使用 Express')

  // 从 root 到 src/server 收集
  const result = loadHierarchicalAgentsMd(testDir, join(testDir, 'src', 'server'))
  assert(result !== null, '分层收集返回非 null')
  if (result) {
    // 应包含 3 个 INSTRUCTIONS 块
    const instructionCount = result.split('<INSTRUCTIONS>').length - 1
    assert(instructionCount === 3, `收集到 3 层 AGENTS.md（实际: ${instructionCount}）`)

    // 顺序：root → src → server
    const rootPos = result.indexOf('# Root')
    const srcPos = result.indexOf('# Src')
    const serverPos = result.indexOf('# Server')
    assert(rootPos < srcPos, 'root 在 src 前面')
    assert(srcPos < serverPos, 'src 在 server 前面')

    // 包含路径 header
    assert(result.includes(`# AGENTS.md instructions for ${testDir}`), '包含 root 路径 header')
    assert(result.includes(`# AGENTS.md instructions for ${join(testDir, 'src')}`), '包含 src 路径 header')
    assert(result.includes(`# AGENTS.md instructions for ${join(testDir, 'src', 'server')}`), '包含 server 路径 header')
  }

  // 只到 src 层
  const partial = loadHierarchicalAgentsMd(testDir, join(testDir, 'src'))
  if (partial) {
    const count = partial.split('<INSTRUCTIONS>').length - 1
    assert(count === 2, `只到 src 层时收集到 2 层（实际: ${count}）`)
  }

  // 没有文件的层
  mkdirSync(join(testDir, 'empty'), { recursive: true })
  const emptyResult = loadHierarchicalAgentsMd(testDir, join(testDir, 'empty'))
  if (emptyResult) {
    const count = emptyResult.split('<INSTRUCTIONS>').length - 1
    assert(count === 1, `empty 子目录只有 root 的 1 层（实际: ${count}）`)
  }
} finally {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
}

// ===== 6. override 优先级 =====
console.log('\n=== 6. override 优先级 ===')
const overrideDir = join(process.cwd(), '.test-override')
try {
  if (existsSync(overrideDir)) rmSync(overrideDir, { recursive: true })
  mkdirSync(overrideDir)

  writeFileSync(join(overrideDir, 'AGENTS.md'), '默认指令')
  writeFileSync(join(overrideDir, 'AGENTS.override.md'), '覆盖指令')

  const result = loadAgentsMd(overrideDir)
  assert(result !== null, 'override 目录有文件')
  assert(result!.content === '覆盖指令', 'override 优先于默认')

  // 分层收集时也用 override
  const hierResult = loadHierarchicalAgentsMd(overrideDir, overrideDir)
  assert(hierResult !== null, '分层收集 override 非 null')
  assert(hierResult!.includes('覆盖指令'), '分层收集包含 override 内容')
  assert(!hierResult!.includes('默认指令'), '分层收集不包含被覆盖的默认内容')
} finally {
  if (existsSync(overrideDir)) rmSync(overrideDir, { recursive: true })
}

// ===== 7. 预算限制 =====
console.log('\n=== 7. 预算限制 ===')
const budgetDir = join(process.cwd(), '.test-budget')
try {
  if (existsSync(budgetDir)) rmSync(budgetDir, { recursive: true })
  mkdirSync(join(budgetDir, 'sub'), { recursive: true })

  // 写一个大文件（超过 32KiB）
  const bigContent = 'x'.repeat(33 * 1024)
  writeFileSync(join(budgetDir, 'AGENTS.md'), bigContent)
  writeFileSync(join(budgetDir, 'sub', 'AGENTS.md'), 'sub content')

  const result = loadHierarchicalAgentsMd(budgetDir, join(budgetDir, 'sub'))
  assert(result !== null, '大文件预算测试返回非 null')
  // 应该被截断，不超过 32KiB + 包装开销
  assert(result!.length < 34 * 1024, `总输出在预算范围内（实际: ${result!.length} 字节）`)
} finally {
  if (existsSync(budgetDir)) rmSync(budgetDir, { recursive: true })
}

// ===== 8. formatAgentsMdInjection =====
console.log('\n=== 8. formatAgentsMdInjection ===')
const injection = formatAgentsMdInjection('测试内容', '/test/path')
assert(injection.startsWith('# AGENTS.md instructions for /test/path'), 'header 正确')
assert(injection.includes('<INSTRUCTIONS>'), '包含开始标签')
assert(injection.includes('</INSTRUCTIONS>'), '包含结束标签')
assert(injection.includes('测试内容'), '包含原始内容')

// ===== 9. buildEnvironmentContext =====
console.log('\n=== 9. buildEnvironmentContext ===')
const env = buildEnvironmentContext()
assert(env.includes('<environment_context>'), '包含 environment_context 标签')
assert(env.includes('<cwd>'), '包含 cwd 标签')

// ===== 结果 =====
console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===`)
if (failed > 0) process.exit(1)
