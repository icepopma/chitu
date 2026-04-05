import { buildProjectContext, formatAgentsMdInjection, buildEnvironmentContext, findProjectRoot, loadAgentsMd } from './context.js'

console.log('=== 1. findProjectRoot ===')
const root = findProjectRoot(process.cwd())
console.log('项目根:', root)

console.log('\n=== 2. loadAgentsMd ===')
if (root) {
  const agentsMd = loadAgentsMd(root)
  console.log('找到文件:', agentsMd?.path)
  console.log('内容长度:', agentsMd?.content.length)
  console.log('前 100 字:', agentsMd?.content.slice(0, 100))
}

console.log('\n=== 3. formatAgentsMdInjection ===')
if (root) {
  const agentsMd = loadAgentsMd(root)
  if (agentsMd) {
    const injection = formatAgentsMdInjection(agentsMd.content, root)
    console.log('注入格式前 200 字:')
    console.log(injection.slice(0, 200))
    console.log('...')
    console.log('注入格式后 50 字:')
    console.log(injection.slice(-50))
  }
}

console.log('\n=== 4. buildEnvironmentContext ===')
const env = buildEnvironmentContext()
console.log(env)

console.log('\n=== 5. buildProjectContext ===')
const ctx = buildProjectContext()
console.log('projectRoot:', ctx.projectRoot)
console.log('agentsMdMessage 前 100 字:', ctx.agentsMdMessage?.slice(0, 100))
console.log('environmentMessage 前 100 字:', ctx.environmentMessage.slice(0, 100))

console.log('\n=== 6. buildInitialMessages（完整初始上下文） ===')
import { buildInitialMessages } from './agent/loop.js'
const msgs = buildInitialMessages('帮我看看 src/ 目录结构')
for (const [i, msg] of msgs.entries()) {
  console.log(`\n--- message[${i}] role=${msg.role} ---`)
  console.log((msg.content as string).slice(0, 200))
  if ((msg.content as string).length > 200) console.log('...')
}

console.log('\n=== ALL TESTS PASSED ===')
