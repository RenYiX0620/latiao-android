# Latiao Android

辣条（Latiao）的安卓客户端——手机上的本地 Agent，与桌面版（Tauri + Python sidecar）**独立演进**。

## 定位

- **不是**桌面版的远程遥控端，而是独立可运行的手机应用
- **不带**键鼠控制、进程管理、任意 shell——这些是桌面场景的能力
- **带上**：对话循环、联网工具（行情/搜索）、定时提醒、记忆、文档生成
- **本地模型**：App 内直接跑 GGUF（见下），离线可用

## 技术选型（2026-09-29 定）

| 层 | 选型 | 依据 |
|---|---|---|
| UI | React Native + TypeScript | 与桌面版 React 设计体系可复用；PocketPal 同路线 |
| 推理 | llama.cpp（RN 绑定，如 llama.rn） | 与桌面版同一引擎；PocketPal 已验证手机可跑 |
| 模型 | GGUF，App 内从 Hugging Face 下载 | 量化模型、按需加载 |
| 工具层 | TS/Kotlin 重写**手机常用子集** | 不搬 Python sidecar（Android 无随包 CPython 的可行玩法） |
| Agent 循环 | TS 重写精简版 | 步数/预算/确认闸门等机制可从桌面版对照移植 |

**参考实现**：[pocketpal-ai](https://github.com/a-ghorbani/pocketpal-ai)（MIT）——模型加载层可直接对照；它没有 agent 工具循环，那部分是本项目的主工程量。

## 范围

### 做（MVP）

- [ ] RN 工程骨架 + 对话 UI（可参考桌面版视觉）
- [ ] 本地 GGUF 加载与流式对话（llama.cpp 绑定）
- [ ] 云端模型可选（BYO-key，与桌面版一致）
- [ ] 薄工具层：联网搜索、行情查询、写文件/生成文档、create_cron 提醒
- [ ] 精简 agent 循环：MAX_STEPS、工具确认、基本验证
- [ ] 记忆：本地 SQLite

### 不做

- 键鼠 / Accessibility 控制
- 任意 shell、进程管理
- 随包 Python sidecar
- 桌面版 31 个工具全量移植

## 与桌面版共享什么

| 共享 | 方式 |
|---|---|
| 硬规则 / 提示词体系 | 复制 + 手动同步（桌面版改动不会自动生效） |
| 技能格式（SKILL.md） | 兼容读取 |
| 品牌与设计稿 | 参照 |

桌面版仓库：`RenYiX0620/Latiao`（本仓不依赖其构建链）。

## 状态

刚建仓，尚未脚手架。下一步：RN 初始化 + 模型加载 POC。
