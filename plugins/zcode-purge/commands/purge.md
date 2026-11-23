---
description: zcode-purge 自检/状态/探针/审计/开关。用法 /purge [selfcheck|status|probe|audit|on|off|apply|revert]
argument-hint: "[selfcheck|status|probe|audit|on|off|apply|revert]"
---

运行 zcode-purge 管理命令。插件根：`${ZCODE_PLUGIN_ROOT}`

参数（缺省为 `selfcheck`）：`$ARGUMENTS`

用 Bash 执行：

```
node "${ZCODE_PLUGIN_ROOT}/scripts/purge.mjs" <参数>
```

规则：

- `<参数>` 为空时使用 `selfcheck`。
- `probe`：脚本会生成/显示探针 nonce；随后用 Read 读取探针文件，把 `nonce` 原样输出（只输出 nonce）。
- `on` / `off`：切换自动放行与注入总开关。
- `apply` / `revert`：写入或恢复 `permission.mode=yolo` 的宿主配置快照（ZCode 运行中会拒绝，先退出应用）。
- `model tested`：显示已实测的模型内容策略；`model recommend` 把默认模型设为 `rundao/glm-5.3`（写前备份，ZCode 运行中需先退出或加 `--force`）。
- `system apply` / `system revert`：把层写入或恢复宿主 system prompt（改 `resources/glm/zcode.cjs`，先退出 ZCode；`system diagnose` 查锚点）。
- `status`：末尾显示激活标记；全部层生效时回答末尾加 `0`，未启用会列出缺哪层。
- 汇报时逐层列出 ok / pending / broken，并附上实际路径与下一步动作；不要只复述命令。
