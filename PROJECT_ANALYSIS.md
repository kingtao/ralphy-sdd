# Ralphy-OpenSpec 工程分析报告

> 分析日期：2026-04-10  
> 版本：v0.3.6  
> 作者：AI Analysis

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [目录结构](#3-目录结构)
4. [核心架构](#4-核心架构)
5. [Ralph Loop 实现原理](#5-ralph-loop-实现原理)
6. [OpenSpec 集成原理](#6-openspec-集成原理)
7. [多后端适配层](#7-多后端适配层)
8. [预算与约束系统](#8-预算与约束系统)
9. [工作流全链路分析](#9-工作流全链路分析)
10. [数据流与状态管理](#10-数据流与状态管理)
11. [Artifact 系统](#11-artifact-系统)
12. [当前状态与活跃变更](#12-当前状态与活跃变更)
13. [架构优缺点分析](#13-架构优缺点分析)
14. [改进建议](#14-改进建议)

---

## 1. 项目概述

**ralphy-sdd** 是一个 CLI 工具，将 **OpenSpec**（规格驱动开发）与 **Ralph Loop**（迭代式 AI 执行）结合，用于实现可预测的 AI 辅助编码。它支持跨 Codex、OpenCode、Claude Code 三种 AI 编码工具使用。

核心理念：
- **Spec-driven**：以 `openspec/` 目录下的规格文件为"真相来源"（source of truth）
- **Self-correcting loop**：AI 执行 → 验证 → 诊断 → 修复 → 再验证的自修正循环
- **Budget-bounded**：通过三级预算（optimal / warning / hard）控制 AI 的执行开销

---

## 2. 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript (strict mode) |
| 运行时 | Node.js >= 20.19.0 |
| 包管理 | npm |
| 构建 | tsc (TypeScript compiler) |
| CLI 框架 | commander v14 |
| 数据库 | better-sqlite3 (持久化) |
| Schema 验证 | zod v4 |
| 进程执行 | execa v9 |
| 文件匹配 | fast-glob + minimatch |
| 配置解析 | yaml v2 |
| 测试框架 | vitest v4 |
| 文档站 | Astro |

---

## 3. 目录结构

```
ralphy-openspec/
├── src/                          # 源代码
│   ├── index.ts                  # CLI 入口，注册所有命令
│   ├── cli/                      # CLI 命令实现
│   │   ├── init.ts               # `ralphy-sdd init` - 初始化项目
│   │   ├── run.ts                # `ralphy-sdd run` - 执行任务循环
│   │   ├── status.ts             # `ralphy-sdd status` - 查看运行状态
│   │   ├── report.ts             # `ralphy-sdd report` - 生成报告
│   │   ├── budget.ts             # `ralphy-sdd budget` - 预算管理
│   │   ├── validate.ts           # `ralphy-sdd validate` - 验证脚手架
│   │   ├── update.ts             # `ralphy-sdd update` - 更新模板
│   │   ├── tail.ts               # `ralphy-sdd tail` - 实时查看事件
│   │   └── checkpoint.ts         # `ralphy-sdd checkpoint` - 手动创建检查点
│   ├── core/                     # 核心引擎
│   │   ├── engine/               # 执行引擎（状态机 + 修复逻辑）
│   │   │   ├── loop.ts           # ★ 核心：EngineLoop 状态机（~1000行）
│   │   │   ├── phases.ts         # 阶段定义
│   │   │   ├── context-pack.ts   # 上下文压缩
│   │   │   ├── repair.ts         # 修复笔记生成
│   │   │   └── constraints.ts    # Sprint 约束检查
│   │   ├── spec/                 # 规格加载与解析
│   │   │   ├── loader.ts         # SpecLoader - 加载 project.yml
│   │   │   ├── schemas.ts        # Zod schema 定义
│   │   │   ├── types.ts          # 核心类型定义
│   │   │   ├── dag.ts            # 任务 DAG 拓扑排序
│   │   │   ├── file-contract.ts  # 文件合约评估
│   │   │   └── sprint-defaults.ts # Sprint 大小默认预算
│   │   ├── backends/             # AI 工具后端适配器
│   │   │   ├── types.ts          # CodingBackend 接口
│   │   │   ├── codex.ts         # Codex 适配器
│   │   │   ├── opencode.ts       # OpenCode 适配器
│   │   │   ├── claude-code.ts    # Claude Code 适配器
│   │   │   └── noop.ts           # 空操作后端（测试用）
│   │   ├── validators/           # 验证器
│   │   │   ├── runner.ts         # ValidatorRunner - 执行验证
│   │   │   ├── types.ts          # 验证器类型
│   │   │   ├── signatures.ts     # Issue 签名（用于卡死检测）
│   │   │   └── parsers/          # 输出解析器（tsc/eslint/jest）
│   │   ├── budgets/              # 预算管理
│   │   │   ├── manager.ts        # BudgetManager - 预算追踪
│   │   │   ├── state.ts          # BudgetState - 使用状态
│   │   │   ├── tiers.ts          # 三级预算定义
│   │   │   └── errors.ts         # BudgetExhaustedError
│   │   ├── memory/               # 持久化层
│   │   │   ├── persistence.ts    # PersistenceLayer - SQLite CRUD
│   │   │   ├── ledger.ts         # LedgerLogger - 事件日志
│   │   │   └── schema.sql        # 数据库 Schema
│   │   ├── workspace/            # 工作空间管理
│   │   │   ├── manager.ts        # WorkspaceManager 接口
│   │   │   ├── patch-mode.ts     # Patch 模式（默认，在主分支工作）
│   │   │   ├── worktree-mode.ts  # Worktree 模式（git worktree 隔离）
│   │   │   ├── merge.ts          # 合并策略
│   │   │   ├── contract-enforcer.ts # 文件合约执行器
│   │   │   └── scope-detector.ts # 作用域违规检测
│   │   ├── artifacts/            # Artifact 文件写入
│   │   ├── reporting/            # 报告生成
│   │   └── folders.ts            # 目录常量
│   ├── templates/                # AI 工具提示模板
│   │   ├── codex/               # Codex 专用模板
│   │   ├── claude-code/          # Claude Code 专用模板
│   │   ├── opencode/             # OpenCode 专用模板（AGENTS.md）
│   │   └── shared/               # 共享模板
│   ├── utils/                    # 工具函数
│   └── shims/                    # 类型补丁
├── openspec/                     # ★ OpenSpec 目录
│   ├── project.md                # 项目上下文文档
│   ├── project.yml               # ★ 项目配置 + 任务定义
│   ├── changes/                  # 活跃的变更提案
│   │   └── add-cli-plan-command/ # 当前进行中的变更
│   └── archive/                  # 已归档的变更
│       ├── ralphy-sdd-v2/
│       ├── ralphy-sdd-v2.1-budget-sprint/
│       └── docs-refresh-readme-site-changelog/
├── ralphy-sdd/                  # ★ 运行时 Artifact 目录
│   ├── STATUS.md                 # 当前运行状态
│   ├── TASKS.md                  # 任务看板
│   ├── BUDGET.md                 # 预算报告
│   ├── config.json               # 运行时配置
│   ├── ralphy.db / state.db      # SQLite 持久化数据
│   ├── runs/                     # 运行日志（不可变）
│   └── tasks/                    # 任务上下文/修复笔记
├── docs/                         # Astro 文档站
├── .claude/commands/             # Claude Code 自定义命令
└── AGENTS.md                     # OpenCode Agent 指令
```

---

## 4. 核心架构

### 4.1 架构全景

```
┌─────────────────────────────────────────────────────────┐
│                     CLI Layer (commander)                │
│   init │ run │ status │ report │ budget │ validate │ ...│
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────┐
│              EngineLoop (状态机)                     │
│  PLAN → PREP → EXEC → VALIDATE → DIAGNOSE →       │
│  REPAIR → CHECKPOINT → DONE                        │
│                                                     │
│  ┌─────────┐  ┌───────────┐  ┌──────────────┐     │
│  │ Backend │  │ Validator │  │   Budget     │     │
│  │ Adapter │  │  Runner   │  │  Manager     │     │
│  └────┬────┘  └─────┬─────┘  └──────┬───────┘     │
│       │             │               │               │
└───────┼─────────────┼───────────────┼───────────────┘
        │             │               │
        ▼             ▼               ▼
┌──────────┐  ┌──────────┐  ┌───────────────┐
│ Codex   │  │ tsc      │  │ BudgetState   │
│ OpenCode │  │ eslint   │  │ 三级预算追踪    │
│ Claude   │  │ jest     │  └───────────────┘
│ Noop     │  └──────────┘
└──────────┘
        │
┌───────┼─────────────────────────────────────┐
│       ▼                                     │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Workspace    │  │  Persistence Layer   │ │
│  │ patch/worktree│ │  SQLite + Ledger     │ │
│  └──────────────┘  └──────────────────────┘ │
│                                              │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Artifacts    │  │  SpecLoader (Zod)    │ │
│  │ STATUS/TASKS │  │  project.yml → Types │ │
│  └──────────────┘  └──────────────────────┘ │
│                  Storage Layer               │
└──────────────────────────────────────────────┘
```

### 4.2 关键接口

```typescript
// AI 后端接口
interface CodingBackend {
  id: string;
  implement(env: BackendEnv, input: ImplementInput): Promise<ImplementOutput>;
}

// 工作空间管理接口
interface WorkspaceManager {
  mode: string;
  prepare(taskId: string): Promise<WorkspaceContext>;
  getWorkingDir(taskId: string): string;
  getChangedFiles(taskId: string): Promise<Array<{ file: string; isNew: boolean }>>;
  enforceContract(taskId: string, contract: FileContract): Promise<ContractViolation[]>;
  checkpoint(taskId: string, message: string): Promise<CheckpointRef>;
  merge(taskId: string): Promise<void>;
  revert(taskId: string): Promise<void>;
  cleanup(taskId: string): Promise<void>;
}
```

---

## 5. Ralph Loop 实现原理

### 5.1 什么是 Ralph Loop？

Ralph Loop（命名来自 Ralph Wiggum）是一种迭代式 AI 执行方法论：**同一个提示词被重复执行，直到任务完成或资源耗尽**。核心思想是利用 AI 的"自修正"能力：

1. 给 AI 一个任务
2. AI 执行实现
3. 运行验证器（类型检查 / 测试 / lint）
4. 如果失败，将错误信息反馈给 AI，要求修复
5. 重复直到成功或达到预算上限

### 5.2 EngineLoop 状态机

`EngineLoop`（`src/core/engine/loop.ts`，约 1000 行）是整个系统的核心，实现了一个多阶段状态机：

```
PLAN → EXEC → VALIDATE → (成功) → CHECKPOINT → DONE
                  ↓
            (失败) → DIAGNOSE → REPAIR → (回到 EXEC)
                  ↓
            (卡死/预算耗尽) → BLOCKED
```

#### 主循环伪代码：

```
for iter = 1 to maxIterations:
    1. 预算预检 (preflightOrThrow)
       - 检查 run 级别和 task 级别的硬上限
       - 超限则 blockHardCap()
    
    2. 降级判断
       - 如果进入 WARNING 层，启用降级行为：
         - 上下文压缩（仅保留失败的验证器输出）
         - 禁止非修复操作
         - 跳过可选调用（self-review 等）
    
    3. EXEC 阶段
       - 调用 Backend.implement()
       - 将任务描述 + 修复笔记发给 AI
       - 记录预估使用量 (USD/tokens)
    
    4. VALIDATE 阶段
       - 运行所有配置的验证器 (tsc/jest/eslint)
       - 检查文件合约违规
       - 检查 Sprint 约束和作用域违规
    
    5. 判断结果
       a. 全部通过 → CHECKPOINT → merge → DONE
       b. 有错误 → DIAGNOSE:
          - 检测卡死（连续3轮相同的 issue 签名）
          - 卡死 → 退出 (exitCode=3)
          - 否则 → REPAIR → 生成修复笔记 → 下一轮迭代
```

### 5.3 卡死检测机制

通过 **Issue Signature** 实现：

```typescript
// 每个验证问题生成一个签名
export function issueSignature(i: Issue): string {
  // 基于 kind + file + line + message 生成哈希
}
```

如果连续 3 轮迭代出现相同的签名集合，判定为"卡死"（stuck），立即停止并返回 `exitCode=3`。

### 5.4 修复笔记 (Repair Notes)

每次验证失败后，系统会将所有 issue 整理成结构化的"修复笔记"传递给 AI 的下一轮：

```markdown
# Repair notes
## Constraints (WARNING tier)
- Fix only failing validators
- Do NOT refactor unrelated code
## Issues
- [error] tsc (src/foo.ts:42): Property 'x' does not exist on type 'Y'
```

### 5.5 上下文压缩 (Context Pack)

在 WARNING 预算层级下，系统会压缩发送给 AI 的上下文：
- **optimal 层**：完整上下文（所有验证器摘要）
- **warning 层**：仅包含失败验证器的输出 + 涉及文件列表，截断到 8000 字符

---

## 6. OpenSpec 集成原理

### 6.1 OpenSpec 目录结构

```
openspec/
├── project.md          # 项目上下文（人类可读）
├── project.yml         # ★ 机器可读的项目配置 + 任务定义
├── specs/              # 当前规格（source of truth）
├── changes/            # 活跃变更提案
│   └── <change-name>/
│       ├── proposal.md # 变更提案（why/what/scope）
│       ├── tasks.md    # 任务清单（带验收标准）
│       └── specs/      # 规格增量（ADDED/MODIFIED/REMOVED）
└── archive/            # 已归档的变更
```

### 6.2 project.yml 核心配置

`project.yml` 是整个系统的配置中枢，包含：

| 配置块 | 作用 |
|--------|------|
| `project` | 项目名称、根目录、语言、包管理器 |
| `defaults` | 默认后端、工作空间模式、验证器 |
| `policies` | 策略（如 scopeGuard: warn/block/off） |
| `artifacts` | Artifact 输出控制 |
| `budgets.run` | 运行级预算上限（USD/tokens/时间/迭代次数） |
| `sprint_defaults` | 各 Sprint 大小的默认预算（XS/S/M/L/XL） |
| `backends` | 后端配置（命令、模型层级） |
| `validators` | 验证器列表（命令、超时、解析器） |
| `tasks` | ★ 任务定义（目标、预算、文件合约、验收标准） |

### 6.3 Spec 解析流程

```
project.yml → YAML.parse → Zod Schema 验证 → ProjectSpec 类型
                                ↓
                     Sprint Defaults 合并
                     (如果 task 有 sprint.size 但没有显式 budget)
                                ↓
                     buildTaskDAG() → 拓扑排序
                                ↓
                     EngineLoop.run() → 按序执行
```

### 6.4 OpenSpec 四阶段工作流

整个工作流遵循 AGENTS.md 中定义的四阶段模型：

1. **Plan** (PRD → OpenSpec)
   - 读取 `openspec/project.md` 和现有规格
   - 创建变更文件夹 (`proposal.md` + `tasks.md` + `specs/`)
   - 使用 MUST/SHALL 语义的需求描述

2. **Implement** (Tasks → Code)
   - 按 `tasks.md` 顺序执行
   - 频繁运行测试
   - 验证通过后才标记完成

3. **Validate** (验收标准)
   - 映射验收标准到测试
   - 运行 `npm test`

4. **Archive**
   - 移动到 `openspec/archive/`
   - 确保 `openspec/specs/` 反映最终状态

---

## 7. 多后端适配层

### 7.1 适配器架构

系统通过 `CodingBackend` 接口抽象了不同的 AI 编码工具：

| 后端 | 命令 | 实现方式 |
|------|------|----------|
| Codex | `codex` | 调用 Codex CLI，构建 prompt 发送给 AI |
| OpenCode | `opencode` | 调用 opencode CLI |
| Claude Code | `claude` | 调用 claude CLI |
| Noop | - | 空操作，用于测试和 dry-run |

### 7.2 后端调用流程

每个后端的 `implement()` 方法：
1. 构建 prompt（包含任务描述 + 修复笔记 + 约束）
2. 通过 `execa` 调用外部 CLI 工具
3. 等待执行完成
4. 返回 `{ ok, message, estimatedUsd?, estimatedTokens? }`

### 7.3 提示模板

各后端有专用模板，通过 `ralphy-sdd init` 安装到项目中：

- **Codex**: `.codex/prompts/ralphy-{plan,implement,validate,archive}.md`
- **Claude Code**: `.claude/commands/ralphy-{plan,implement,validate,archive}.md`
- **OpenCode**: `AGENTS.md`

---

## 8. 预算与约束系统

### 8.1 三级预算模型

```
┌─────────────────────────────────────────────┐
│  OPTIMAL (正常操作)                           │
│  - 完整上下文                                 │
│  - 所有功能启用                               │
├─────────────────────────────────────────────┤
│  WARNING (降级)                               │
│  - 上下文压缩                                 │
│  - 仅修复模式                                 │
│  - 禁用可选调用                               │
├─────────────────────────────────────────────┤
│  HARD (硬上限)                                │
│  - 立即停止                                   │
│  - 标记 BLOCKED                              │
│  - 保留工作空间                               │
│  - 写入失败摘要                               │
└─────────────────────────────────────────────┘
```

### 8.2 预算维度

每级预算可以设置以下维度：
- **USD**: 预估花费
- **Tokens**: 消耗的 token 数
- **Wall Time**: 实际运行时间
- **Max Iterations**: 最大迭代次数

### 8.3 双层预算管理

系统实现了两层预算管理：
- **Run 级别** (`runBudgetManager`): 整个运行的全局上限
- **Task 级别** (`taskBudgetManager`): 单个任务的上限

两者同时生效，任意一个触达硬上限都会停止执行。

### 8.4 Sprint 大小 → 默认预算

| 大小 | Optimal USD | Hard USD | Max Iterations |
|------|-------------|----------|----------------|
| XS   | $0.20       | $0.50    | 3              |
| S    | $0.50       | $1.20    | 5              |
| M    | $1.20       | $3.00    | 8              |
| L    | $2.50       | $6.00    | 12             |
| XL   | $5.00       | $12.00   | 20             |

---

## 9. 工作流全链路分析

### 9.1 用户使用流程

```bash
# 1. 初始化项目
ralphy-sdd init

# 2. (手动) 编辑 openspec/project.yml 定义任务
#    或 (未来) ralphy-sdd plan "需求描述"

# 3. 执行任务
ralphy-sdd run --backend codex

# 4. 查看状态
ralphy-sdd status

# 5. 查看报告
ralphy-sdd report
```

### 9.2 `ralphy-sdd run` 执行链路

```
CLI (run.ts)
  │
  ├─ SpecLoader.loadProjectSpec()     # 加载配置
  ├─ buildTaskDAG()                    # 构建任务依赖图
  ├─ createBackend()                   # 选择后端
  ├─ createWorkspace()                 # 选择工作空间模式
  │
  └─ EngineLoop.run()
       │
       ├─ PersistenceLayer.openForRepo()  # 打开 SQLite
       ├─ createRun()                      # 记录运行
       │
       └─ for each task in DAG order:
            │
            └─ runOneTask()
                 │
                 ├─ workspace.prepare()        # 准备工作空间
                 ├─ for iter = 1..maxIter:
                 │    ├─ budgetManager.preflightOrThrow()
                 │    ├─ backend.implement()     # 调用 AI
                 │    ├─ validatorRunner.runAll() # 运行验证
                 │    ├─ workspace.enforceContract() # 合约检查
                 │    ├─ if ok → checkpoint → merge → DONE
                 │    └─ if fail → buildRepairNotes() → next iter
                 │
                 └─ finalizeArtifacts()
```

---

## 10. 数据流与状态管理

### 10.1 持久化层 (SQLite)

通过 `PersistenceLayer` 类管理：

```
ralphy-sdd/ralphy.db (或 state.db)
├── runs: 运行记录（runId, status, startedAt, ...）
├── task_states: 任务状态（taskId, status, phase, iteration, ...）
└── ledger: 事件日志（时间戳, kind, message, data）
```

### 10.2 事件类型 (Ledger Events)

| Kind | 含义 |
|------|------|
| `run_started` / `run_done` / `run_error` | 运行生命周期 |
| `task_started` / `task_done` | 任务生命周期 |
| `exec` | 执行迭代开始 |
| `validate` | 验证结果 |
| `repair` | 进入修复循环 |
| `stuck` | 卡死检测 |
| `hard_cap` / `budget_exceeded` | 预算限制 |
| `degrade` | 降级模式启用 |
| `context_pack` | 上下文压缩 |
| `backend_usage` | 后端使用量 |
| `failure_summary` | 失败摘要 |
| `checkpoint` | 检查点创建 |
| `artifact_error` | Artifact 写入失败 |

---

## 11. Artifact 系统

### 11.1 Artifact 文件

系统在 `ralphy-sdd/` 目录下生成人类可读的 Markdown 文件：

| 文件 | 作用 | 更新频率 |
|------|------|----------|
| `STATUS.md` | 当前运行状态、阶段、迭代、预算 | 每个阶段变更时 |
| `TASKS.md` | 任务看板（表格形式） | 每次状态变更 |
| `BUDGET.md` | 预算使用报告 | 每次状态变更 |
| `runs/<runId>.md` | 不可变的运行日志 | 运行结束时一次写入 |
| `tasks/<taskId>/CONTEXT.md` | 任务上下文 | 每次迭代前 |
| `tasks/<taskId>/REPAIR.md` | 修复笔记 | 验证失败后 |

### 11.2 设计理念

Artifact 系统采用"best-effort"设计：
- 写入失败不阻塞主流程
- 失败后自动禁用 artifacts 继续执行
- 支持 emoji / ASCII / none 三种状态图标风格

---

## 12. 当前状态与活跃变更

### 12.1 已归档变更

| 变更名 | 内容 |
|--------|------|
| `ralphy-sdd-v2` | 核心 v2 架构（引擎、后端、验证器、工作空间） |
| `ralphy-sdd-v2.1-budget-sprint` | 三级预算 + Sprint 语义 |
| `docs-refresh-readme-site-changelog` | 文档站更新 |

### 12.2 活跃变更

- **`add-cli-plan-command`**: 为 CLI 添加 `ralphy-sdd plan` 命令
  - 目标：让用户可以从终端直接将需求转为 OpenSpec 变更和任务
  - 状态：尚未开始实现（tasks 全部未完成）

### 12.3 当前运行状态

最后一次运行停留在任务 `v2.1-1.3.1`（实现优雅的任务阻断），因 Codex Agent 超时（20 分钟）而标记为 error。

---

## 13. 架构优缺点分析

### 13.1 优点

| 方面 | 评价 |
|------|------|
| **架构清晰** | 模块边界清楚，关注点分离良好（engine / backend / validator / workspace / budget） |
| **多后端抽象** | 通过接口统一了不同 AI 工具的调用方式，易于扩展 |
| **预算控制** | 三级预算模型优雅，避免 AI 无限消耗资源 |
| **卡死检测** | 通过 Issue 签名检测循环，避免无效迭代 |
| **可观测性** | Ledger 事件 + Artifact 文件提供了良好的可视化和调试能力 |
| **容错设计** | Artifact 写入采用 best-effort，不阻塞核心流程 |
| **Spec-driven** | 任务定义、预算、文件合约全部声明式配置 |
| **工作空间隔离** | patch/worktree 两种模式，worktree 提供完全隔离 |

### 13.2 缺点与不足

| 方面 | 问题 |
|------|------|
| **EngineLoop 过大** | `loop.ts` 约 1000 行，状态机逻辑、artifact 写入、预算检查混在一起，难以维护 |
| **串行执行** | `max_parallel_tasks: 1`，不支持并行任务执行 |
| **后端使用量估算** | 后端返回的 `estimatedUsd` / `estimatedTokens` 是可选的，多数后端可能不提供，导致预算追踪不准确 |
| **plan 命令缺失** | 目前 Plan 阶段依赖 IDE 交互，无法纯 CLI 完成全流程 |
| **测试覆盖** | 仅有少量测试文件（硬上限、约束策略、状态写入等），核心 loop 缺乏集成测试 |
| **错误恢复** | 运行中断后没有明确的恢复/续跑机制 |
| **Noop 后端局限** | Noop 后端直接返回成功，无法模拟真实的代码修改行为用于端到端测试 |
| **配置文件位置** | `project.yml` 在 `openspec/` 下但包含运行时配置（budgets/backends），职责混合 |

---

## 14. 改进建议

### 14.1 短期可改进项

| 优先级 | 建议 | 说明 |
|--------|------|------|
| 🔴 高 | **完成 `plan` 命令** | 实现 `add-cli-plan-command` 变更，让全流程可 CLI 驱动 |
| 🔴 高 | **拆分 EngineLoop** | 将 artifact 写入、预算检查、状态更新抽取为独立模块 / 中间件 |
| 🟡 中 | **添加集成测试** | 用 Noop 后端（改进为可模拟文件变更版）做端到端测试 |
| 🟡 中 | **断点续跑** | 支持 `ralphy-sdd run --resume` 从上次中断处继续 |
| 🟢 低 | **事件钩子** | 允许用户注册 pre/post 钩子（如 pre-exec、post-validate） |

### 14.2 中期架构演进

| 方向 | 说明 |
|------|------|
| **并行任务执行** | 对无依赖的任务支持并行，提升吞吐 |
| **插件化验证器** | 允许用户编写自定义验证器解析器 |
| **远程后端** | 支持 API 调用式后端（不依赖本地 CLI） |
| **实时 Dashboard** | 通过 WebSocket 或文件轮询提供实时 Web UI |
| **预算估算增强** | 集成 token 计数库，在调用前预估消耗 |

### 14.3 长期愿景

| 方向 | 说明 |
|------|------|
| **Multi-agent 编排** | 多个 AI agent 协作完成不同子任务 |
| **学习型修复** | 基于历史失败模式自动选择修复策略 |
| **Spec 自动演化** | 根据实现结果自动更新规格 |

---

## 附录：关键文件速查

| 关键概念 | 文件路径 |
|----------|----------|
| CLI 入口 | `src/index.ts` |
| 引擎状态机 | `src/core/engine/loop.ts` |
| 类型定义 | `src/core/spec/types.ts` |
| Zod Schema | `src/core/spec/schemas.ts` |
| 配置加载 | `src/core/spec/loader.ts` |
| 任务 DAG | `src/core/spec/dag.ts` |
| 后端接口 | `src/core/backends/types.ts` |
| 预算管理 | `src/core/budgets/manager.ts` |
| 验证执行 | `src/core/validators/runner.ts` |
| SQLite 持久化 | `src/core/memory/persistence.ts` |
| 工作空间接口 | `src/core/workspace/manager.ts` |
| 项目配置 | `openspec/project.yml` |
| Agent 指令 | `AGENTS.md` |
| Ralph Loop 模板 | `src/templates/shared/ralph-loop-prompt-template.md` |
