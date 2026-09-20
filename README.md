# 电子表格公式引擎与依赖追踪

纯浏览器端电子表格：手写公式 Lexer/Parser/AST、12 个内置函数、三类节点依赖图、
Kahn 与 DFS 三色标记两套拓扑排序/循环检测、SVG 依赖图可视化，全部计算运行在
**Web Worker** 中，主线程只负责 UI 与 SVG 渲染。

## 快速开始

```bash
npm install
npm run dev        # 启动开发服务器（Vite）
npm test           # 运行全部单元测试（Vitest，74 个用例）
npm run build      # tsc 严格类型检查 + 生产构建（Worker 独立分包）
npm run typecheck  # 仅类型检查
```

打开后自动载入示例工作簿，覆盖全部函数、错误类型与三种循环引用。

## 操作指南

| 操作 | 方式 |
| --- | --- |
| 选择单元格 | 鼠标点击 / 方向键 / Tab / Enter |
| 框选 | 鼠标拖拽，或 Shift+点击从活动格扩展 |
| 多选（不连续） | Ctrl/⌘+点击 |
| 编辑 | 双击、F2，或直接键入字符；公式栏可随时输入 |
| 提交 / 取消 | Enter / Tab 提交并移动，Esc 取消 |
| 删除 | Delete / Backspace |
| 依赖图 | 缩放（滚轮/按钮）、平移（拖拽画布）、悬停提示、点击节点与网格双向联动 |
| 拓扑算法 | 顶部下拉在 **Kahn** 与 **DFS 三色标记** 间切换 |

## 功能与代码对照

### 引擎（`src/engine/`，运行于 Web Worker）

| # | 功能 | 实现文件 |
| --- | --- | --- |
| 5 | 数字/文本/布尔/空值/错误/公式 | `value.ts`、`workbook.ts`（`parseLiteral`） |
| 6 | `A1`、`$A$1`、`$A1`、`A$1` | `a1.ts`（`parseReference` 保留绝对标志）、`lexer.ts` |
| 7、13、14 | 区域引用 `A1:B10`、引用解析、区域展开 | `a1.ts`（`parseRange`/`expandRange`）、`evaluator.ts` |
| 8 | 手写词法分析（含位置 offset） | `lexer.ts` |
| 9、10 | 递归下降 Parser、AST | `parser.ts`、`ast.ts` |
| 11 | 语法错误定位（offset/column/长度） | `parser.ts`（`ParseError`）、UI 中用 `^^^` 标注 |
| 12 | AST 树展示 | `ast.ts`（`astToTreeText`）+ 右侧 AST 面板 |
| 15 | SUM/AVERAGE/MIN/MAX/ROUND/ABS/IF/AND/OR/NOT/COUNT/COUNTA | `functions.ts`（IF 惰性求值在 `evaluator.ts`） |
| 16、17 | cell/formula/range 三类节点；owns/references/covers 边 | `graph.ts` |
| 18 | 邻接表 `out` + 逆邻接表 `incoming`（Map/Set） | `graph.ts` |
| 19 | 从 AST 提取依赖引用（访问者模式） | `dependencies.ts` |
| 20 | Kahn 与 DFS 两套拓扑排序 | `topology.ts` |
| 21、22 | 全量重算 + 重算顺序展示 | `workbook.ts`、重算顺序面板 |
| 23 | 自引用 / 直接 / 间接循环检测 | `topology.ts`（三色标记 + 环分类） |
| 24 | 环上单元格为 `#CYCLE!`，下游按错误传播继续求值 | `workbook.ts`（cyclic vs blocked） |
| 25、26 | 五类基础错误 + 错误值作为一等值传播 | `errors.ts`、`evaluator.ts` |
| — | 函数注册表、签名与参数校验、AST 缓存 | `functions.ts`、`workbook.ts`（`astCache`） |

### UI（`src/ui/`、`src/main.ts`，主线程）

| # | 功能 | 实现文件 |
| --- | --- | --- |
| 1、2 | 单元格网格 + 行列标题（sticky 表头） | `ui/grid.ts`、`style.css` |
| 3 | 选区 / Ctrl 多选 / 拖拽框选 / Shift 扩展 | `ui/grid.ts` |
| 4 | 公式栏输入、实时语法校验提示 | `main.ts`（`parsePreview` 走 Worker） |
| 27、28 | SVG 依赖图：缩放、平移、悬停、点击 | `ui/graph.ts` |
| 29、30 | 上游（绿）/下游（橙）高亮，网格 ↔ 图联动 | `ui/graph.ts`、`ui/grid.ts` |
| 31 | 重算顺序面板（含环路径说明与耗时） | `ui/panels.ts` |
| 32 | 错误列表面板（点击定位） | `ui/panels.ts` |
| 33 | 调试面板（值类型徽章、依赖清单、图统计） | `ui/panels.ts` |
| 34、35 | Worker 承担解析/求值/图/重算；主线程只渲染 | `engine.worker.ts`、`ui/state.ts`（`EngineClient`） |

## 架构要点

```
主线程 (main.ts / ui/*)                    Worker (engine.worker.ts)
┌───────────────────────────┐  postMessage ┌────────────────────────────┐
│ 网格 / 公式栏 / SVG / 面板 │ ───────────▶ │ Workbook                   │
│            ▲              │  setCell 等   │  ├─ Lexer → Parser → AST   │
│            │ Snapshot     │ ◀─────────── │  ├─ 依赖提取 → DependencyGraph
└───────────────────────────┘  结构化克隆   │  ├─ Kahn / DFS 拓扑+循环    │
                                           │  └─ 按序 Evaluator 求值     │
                                           └────────────────────────────┘
```

- **AST 节点**：number/string/boolean/error/reference/range/unary/binary/function，
  统一携带 `pos { offset, length }`，通过 `AstVisitor` 访问者分发（求值、依赖提取各一个访问者）。
- **依赖图三类节点**：`cell:A1`、`formula:A1`、`range:A1|A1:B2`。
  边方向恒为“依赖者 → 被依赖者”：cell `owns` formula，formula `references-cell`
  cell / `references-range` range，range `covers` 成员 cell。
- **拓扑重算**：先把含 formula/range 的完整图压缩为 cell→cell 图；
  真正在环上的单元格写 `#CYCLE!`，被环阻塞（blocked）的下游公式在环节点定值后
  照常求值，因此 `#CYCLE!` 与其它错误一样沿算术/函数链传播。
- **值语义（简化版 Excel）**：SUM/AVERAGE/MIN/MAX/COUNT 忽略区域内文本与空单元格、
  区域内布尔不计数；IF 为惰性求值（未选中的分支即使含错误也不传播）；
  错误字面量（如单元格直接输入 `#N/A`）与运行时错误等价。

## 测试

`tests/` 共 74 个用例：词法分析、语法分析/AST、地址与区域、求值与错误传播、
依赖图、Kahn/DFS 拓扑、三类循环检测端到端。

```bash
npm test
```
