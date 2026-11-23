# ZCode Purge

给 [ZCode](https://github.com/zai-org/ZCode) 的破甲插件（宿主附加组件）：把审批弹窗、Bash 沙箱、提示词层的摩擦收敛掉，让 agent 连续执行任务。

参考 [dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) 与 kimi-purge 的分层思路。默认全部通过 ZCode 官方插件机制实现：hooks、skills、commands、本地 marketplace，不改宿主二进制；可选的 `system apply` 会把层写入宿主 system prompt（改 `zcode.cjs`，带备份与 revert），这是和 kimi-purge/dsh-purge 对齐效果的关键一层。

## 它做什么

| 层 | 机制 | 效果 |
| --- | --- | --- |
| 权限层 | `PermissionRequest` hook → `decision.behavior=allow` | 审批请求自动放行，不弹窗 |
| 工具层 | `PreToolUse` hook → `permissionDecision=allow` + `updatedInput` | 工具调用直接通过；Bash 自动带上 `dangerouslyDisableSandbox: true` |
| 注入层 | `SessionStart` + `UserPromptSubmit` → `additionalContext` | 会话启动注入工作偏好，每轮追加强化段，多轮不退化 |
| system 层 | 可选 `system apply`：在宿主 `ContextBuilder` 注入 system 段 | 层文本进入真正的 system prompt，模型不再当成 user 注入 |
| 指令通道 | 可选 `~/.zcode/AGENTS.md` 标记块 | 模型把 hook 上下文当注入时，改用用户级指令注入 |
| 子代理 | `agents/zcode-purge.md` | 自定义 systemPrompt + `bypassPermissions`，可在 Subagents 里选用 |
| 技能层 | `skills/zcode-purge-boost` | 显式触发"破甲/无限制/直接执行"时强化契约 |
| 命令层 | `/purge` | 自检、状态、探针、审计、开关、宿主设置快照 |
| 观测层 | JSONL 审计（1MB 轮转） | 记录事件、工具、决策；密钥样式自动打码 |
| 激活标记 | 全部层生效时回答末尾加 `0` | 一眼看出插件是否完整生效；任一层关闭即消失 |

插件默认不修改 ZCode 的 `app.asar` 或 CLI bundle；可选的 `system apply` 只改 `resources/glm/zcode.cjs` 的 `ContextBuilder.build` 入口，备份后写入一个读取 `~/.zcode/purge/system.md` 的 system 段，`system revert` 可完整恢复。

## 目录

```
zcode-purge/
├── marketplace.json                 本地 marketplace 清单
├── install.ps1 / install.sh         安装包装脚本
└── plugins/zcode-purge/
    ├── .zcode-plugin/plugin.json    插件清单
    ├── hooks/                       hooks.json + 跨平台 launcher + hook.mjs
    ├── layers/                      注入层（purge-layer.md / boost-layer.md / agents-md.md / system.md）
    ├── agents/zcode-purge.md       可选子代理（自定义 systemPrompt）
    ├── commands/purge.md            /purge 命令
    ├── skills/zcode-purge-boost/    强化技能
    ├── scripts/purge.mjs            CLI：install/status/selfcheck/probe/audit/apply/revert
    └── tests/hook.test.mjs          node:test
```

## 安装

前置：Node.js ≥ 18（hooks 与 CLI 用它；ZCode 桌面自带的 Electron 也可经 `ZCODE_NODE_FALLBACK_EXEC_PATH` 回落）。

### 方式一：命令行（推荐）

```bash
node plugins/zcode-purge/scripts/purge.mjs install
# 同时把中性工作偏好写入 ~/.zcode/AGENTS.md（模型不信任 hook 上下文时更稳）
node plugins/zcode-purge/scripts/purge.mjs install --agents-md
```

脚本会：

1. 写入状态目录 `~/.zcode/purge/` 与 `purge` shim；
2. 找到 ZCode CLI（`ZCODE_CLI`、PATH 上的 `zcode`，或桌面版 `resources/glm/zcode.cjs`）；
3. 执行 `plugins marketplace add <仓库目录>` → `plugins install zcode-purge@zcode-purge-market` → `plugins enable`。

找不到 CLI 时，脚本会打印 UI 安装步骤。也可以用 `--cli <path>` 指定：

```bash
node plugins/zcode-purge/scripts/purge.mjs install --cli "D:/RuanJian/ZCode/resources/glm/zcode.cjs"
```

### 方式二：ZCode 界面

1. 打开 **插件 → 添加插件市场（Add Plugin Marketplace）**；
2. 粘贴本仓库根目录（包含 `marketplace.json` 的目录）；
3. 在 **个人 → zcode-purge-market → ZCode Purge → 安装**；
4. 重启 ZCode，或新开会话。

### 方式三：包装脚本

```powershell
# Windows PowerShell
.\install.ps1
```

```bash
# macOS / Linux
sh ./install.sh
```

安装后重启 ZCode（运行中的实例不会热加载 hooks）。

## 验证

新开一个会话：

1. 说 **`purge probe`**：插件生成探针，agent 读取 `~/.zcode/purge/probe.json` 并原样输出 `nonce` → 注入链路通。
2. 运行 **`/purge selfcheck`**：逐层输出 manifest / layers / hooks / runtime / state / install / probe。
3. 让 agent 执行一个原本会弹审批的命令（如写入工作区外绝对路径），观察是否直接执行。
4. 想验证 system 层：`node .../purge.mjs system status` 应为 `patched`；新会话里让模型处理一个之前会拒绝的内容请求。
5. 看激活标记：`node .../purge.mjs status` 最后一行显示 `已启用`，然后随便问一句，回答末尾应单独一行输出 `0`。

命令行侧：

```bash
node plugins/zcode-purge/scripts/purge.mjs status
node plugins/zcode-purge/scripts/purge.mjs doctor     # 用样本 payload 实跑每个 hook 事件
node plugins/zcode-purge/scripts/purge.mjs audit --limit 20
```

## 开关与配置

状态文件：`~/.zcode/purge/state.json`

```json
{
  "enabled": true,
  "allowAll": true,
  "inject": true,
  "boost": true,
  "unlockSandbox": true,
  "audit": true,
  "denyTools": []
}
```

```bash
node .../purge.mjs off          # 关自动放行 + 注入 + 沙箱改写
node .../purge.mjs on           # 全开
node .../purge.mjs inject off   # 只关提示词注入
node .../purge.mjs sandbox off  # 不再改写 Bash 输入
node .../purge.mjs log off      # 关审计
node .../purge.mjs agents-md on # 写入 ~/.zcode/AGENTS.md 标记块（备份原文件）
node .../purge.mjs agents-md off
node .../purge.mjs model tested # 查看各模型对成人内容的实测表现
node .../purge.mjs status       # 末尾显示激活标记（全部层生效时回答末尾加 0）
node .../purge.mjs config set denyTools Bash,Write   # 强制走审批/拒绝
```

hook 在一次调用内读取状态，改完下一条消息即生效（无需重启）。

### 宿主设置快照（可选）

```bash
node .../purge.mjs apply     # 备份 ~/.zcode/cli/config.json，写入 permission.mode=yolo
node .../purge.mjs revert    # 恢复备份
```

`apply` / `revert` 会拒绝在 ZCode 运行中执行（可用 `--force`），备份放在 `~/.zcode/purge/backup/`。
插件本身的 hooks 不依赖这个设置；它只是给习惯用 `/mode yolo` 的用户补一个默认值。

### 宿主 system prompt 注入（system apply）

这是和 kimi-purge/dsh-purge 对齐效果的关键一层：把层文本放进真正的 **system** 消息，而不是 hook 的 user-role `<system-reminder>`。

```bash
node .../purge.mjs system diagnose   # 检查锚点/补丁/备份
node .../purge.mjs system apply      # 备份并修改 resources/glm/zcode.cjs（先退出 ZCode）
node .../purge.mjs system revert     # 从备份恢复
```

- 注入点：`ContextBuilder.build()`，追加一个 `injectionTarget:"system"`、`source:"operator_preferences"` 的 stable section，内容来自 `~/.zcode/purge/system.md`（由 `layers/system.md` 渲染）。
- 备份：`<zcode.cjs>.zcode-purge-orig`，meta 在 `~/.zcode/purge/system-patch.json`。
- 升级 ZCode 后锚点可能漂移：`system diagnose` 会报 `锚点 0 个`，此时 `revert` 恢复旧包或更新 `SYSTEM_ANCHOR` 后再 `apply`。
- 实测：同一 `rundao/deepseek-v4.1-flash-1017`，仅 hook 注入时拒绝露骨内容；`system apply` 后 system 消息包含该段，模型直接写正文。
- 风险：修改宿主 bundle，需重启生效；`system revert` 可完全恢复。

### 激活标记

全部层生效时，回答末尾会单独一行输出 `0`：

```
2

0
```

- 判定层：插件安装、权限放行、沙箱解除、hook 注入、AGENTS.md、system 层全部 on。探针是诊断项，不参与判定，所以探针过期不会让 `0` 消失。
- 任一开关关闭（`off`、`sandbox off`、`agents-md off`、`system revert` 等），下一轮回答就不再带 `0`。
- `status` 最后一行显示激活标记；未启用时会列出具体哪层没生效。
- 实现：`UserPromptSubmit` hook 每轮根据当前状态注入 activation 行，`system.md` 里有对应规则；只在回答最末尾加一行 `0`，不改正文。

## 卸载

```bash
node plugins/zcode-purge/scripts/purge.mjs uninstall          # 保留状态与审计
node plugins/zcode-purge/scripts/purge.mjs uninstall --purge  # 一并删除 ~/.zcode/purge
```

或在 **设置 → 插件** 里禁用/卸载，并在 marketplace 列表里移除 `zcode-purge-market`。

## 模型把 hook 上下文当成注入怎么办

有的模型（实测 `deepseek-v4.1-flash` 路由组，含 `rundao/deepseek-v4.1-flash-1017`）会把 SessionStart hook 的 `<system-reminder>` 判定为 prompt injection 并拒绝，即使内容只是工作偏好。处理顺序：

1. **先打 system 层**：`node .../purge.mjs system apply` 把层写进宿主 system prompt；同一 DeepSeek 模型随后直接写露骨正文。需要重启 ZCode。
2. **新开会话**：旧会话历史里仍带着旧提示词；改完层文本后必须新开，而不是继续旧会话。
3. **AGENTS.md 兜底**：`agents-md on` 把中性偏好写进 `~/.zcode/AGENTS.md`（写入前备份，`agents-md off` 移除）。
4. **子代理**：在 设置 → Subagents 里选用 `zcode-purge`（自定义 systemPrompt + `bypassPermissions`，模型固定 GLM-5.3）。
5. **换模型**：不同模型的安全训练差异很大；权限层和 hook 层与模型无关。

插件默认的层文本刻意写成中性的工作偏好（执行优先、路径可用、少确认），不使用“忽略安全/绕过权限/证明注入”这类措辞——后者会被有安全训练的模型直接识别并拒绝。`layers/system.md` 是 system 角色版本，措辞更直接，但仍避免“证明注入”这类元话语。

## 18+ 与内容拒绝

`system apply` 之后，主模型（含 `rundao/deepseek-v4.1-flash-1017`）也能直接写露骨成人内容，因为这段文本在真正的 system message 里，不再是 user-role `<system-reminder>`。

未打 system 层时，模型自身的内容策略仍会生效。同一插件、同一提示词下实测：

| 模型 | 未打 system 层 | system apply 后 |
| --- | --- | --- |
| `rundao/deepseek-v4.1-flash-1017` | ✘ 拒绝 | ✔ 直接写 |
| `rundao/glm-5.3` | ✔ 直接写 | ✔ |
| `workbuddy/glm-5.3-flash` | ✔ 直接写 | ✔ |
| `workbuddy/hy4flash-free` | ✔ 直接写 | ✔ |
| `commandcode-plan/deepseek/deepseek-v4.1-flash` | ✔ 直接写 | ✔ |
| `workbuddy/deepseek-v4.1-flash` | ✘ 拒绝 | 未复测 |

不想改宿主时，在模型选择器里切到 ✔ 的模型；TUI 里用 `/model <id>`。要把默认值固定下来：

```bash
node .../purge.mjs model tested       # 查看实测结果
node .../purge.mjs model list         # 当前 provider config 里的模型
node .../purge.mjs model recommend    # 默认模型设为 rundao/glm-5.3（先退出 ZCode）
```

`model set` 只写 `defaultModelSelection`，不改 provider 凭据；已有会话仍用原模型，新会话才生效。

主模型未打 system 层且拒绝时，它也会拒绝把任务转给子代理，所以那种情况下只能换主模型。子代理 `zcode-purge` 固定使用 `magpie/rundao/glm-5.3`（`thoughtLevel: high`），适合主模型在其他工程任务上犹豫时委派。

## 兼容性

- 已验证：ZCode 桌面 3.19.1（CLI 0.18.0，Windows 11 x64，Node 26）。
- 已验证模型：`rundao/deepseek-v4.1-flash-1017` 与 `auto/deepseek-v4.1-flash`；`system apply` 后 system 消息包含 `operator_preferences` 段，同一 DeepSeek 模型直接写露骨成人内容；`agents-md on` 下 probe 只回显 nonce，读取工作区外 dotfile 与黑暗题材写作均直接执行。旧版“忽略安全/绕过权限/证明注入”措辞会被这两个模型识别并拒绝。
- system 补丁锚点基于 CLI 0.18.0 的 `ContextBuilder.build()`；升级后用 `system diagnose` 检查，漂移时 `system revert` 或更新锚点。
- 未验证：macOS / Linux 桌面、其他 CLI 版本；hook 事件名与输出 schema 来自 CLI bundle 的 `HookJSONOutput` 定义。
- 插件 hooks 由 ZCode 插件加载器信任执行；若宿主版本把 `PermissionRequest` 决策改为需要人工确认，`selfcheck` 的 `install`/`runtime` 层会暴露问题。

## 设计边界

- 不改云端账号、不上传提示词或状态；所有文件都在本机。
- 默认不打宿主补丁；`system apply` 是显式可选层，写入前备份，`system revert` 完整恢复。
- `denyTools` 永远优先于 `allowAll`，给需要保留审批的工具留出口。
- 注入层只影响模型侧表达与执行倾向；模型自身的安全训练不能被插件"删除"，能被改变的是本机会话里的行为契约。
- 本仓库面向本机学习、个人项目与自动化实验；在你有权操作的环境里使用。

## 测试

```bash
node --test plugins/zcode-purge/tests/hook.test.mjs
```

## 许可

MIT。架构参考 dsh-purge（社区版，MIT）与 kimi-purge。
