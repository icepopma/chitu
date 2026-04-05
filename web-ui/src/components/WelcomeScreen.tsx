export function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">🐰</div>
        <h3 className="text-xl font-semibold text-white mb-3">
          你好，我是赤兔
        </h3>
        <p className="text-[#888] text-sm leading-relaxed mb-4">
          我是一个 AI Agent，可以通过工具自主完成任务：
        </p>
        <ul className="text-[#888] text-sm text-left space-y-2 mb-6 inline-block">
          <li className="flex items-center gap-2">
            <span className="text-[#43b581]">&#x2022;</span>
            <span>执行 Shell 命令</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[#43b581]">&#x2022;</span>
            <span>读写和编辑文件</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[#43b581]">&#x2022;</span>
            <span>自主完成多步任务</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-[#43b581]">&#x2022;</span>
            <span>分析和总结代码</span>
          </li>
        </ul>
        <p className="text-[#888] text-sm">
          点击左侧 <strong className="text-white">新建对话</strong> 开始
        </p>
      </div>
    </div>
  )
}
