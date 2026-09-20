/**
 * WorkbookEngine：在 Worker 中运行的核心引擎。
 *
 * 职责：
 *  1. 保存原始输入（特性 1）
 *  2. 词法/语法分析 + AST 缓存（特性 8-12）
 *  3. 提取依赖、构建三类节点/两类边的依赖图（特性 16-19）
 *  4. Kahn 拓扑排序 + 三色循环检测（特性 20、23）
 *  5. 全量重算，错误传播，循环节点给 #CIRC!（特性 21、24-26）
 *  6. 分层布局并序列化快照（特性 27、31、32）
 */
import {
  bool,
  EMPTY,
  err,
  num,
  txt,
  type A1Node,
  type CellValue,
  type ComputedCell,
  type EngineSnapshot,
  type ErrorEntry,
  type ErrorKind,
  type RecalcOrderEntry,
} from './types.js';
import { colToLetters, formatAddr } from './address.js';
import { AstCache } from './ast-cache.js';
import { extractDependencies, extractRanges } from './dependencies.js';
import {
  DependencyGraph,
  cellId,
  formulaId,
  parseCellId,
  rangeId,
} from './graph.js';
import { dfsTopo, detectCycles, kahnTopo, type AdjacencyInput } from './topology.js';
import { layeredLayout } from './layout.js';
import { evaluate } from './evaluator.js';
import { createBuiltinRegistry, type EvalContext } from './functions.js';

interface RawCell {
  row: number;
  col: number;
  raw: string;
}

const NUMBER_LITERAL_RE = /^-?\d*\.?\d+([eE][+-]?\d+)?$/;

export interface EngineOptions {
  rows: number;
  cols: number;
  topoAlgorithm?: 'kahn' | 'dfs';
}

export class WorkbookEngine {
  private readonly cells = new Map<string, RawCell>();
  private readonly astCache = new AstCache();
  private readonly registry = createBuiltinRegistry();
  readonly rows: number;
  readonly cols: number;
  topoAlgorithm: 'kahn' | 'dfs';

  constructor(options: EngineOptions) {
    this.rows = options.rows;
    this.cols = options.cols;
    this.topoAlgorithm = options.topoAlgorithm ?? 'kahn';
  }

  private key(row: number, col: number): string {
    return `${row},${col}`;
  }

  setCell(row: number, col: number, raw: string): void {
    const k = this.key(row, col);
    if (raw === '') {
      this.cells.delete(k);
      return;
    }
    this.cells.set(k, { row, col, raw });
  }

  loadAll(entries: Array<{ row: number; col: number; raw: string }>): void {
    this.cells.clear();
    for (const e of entries) this.setCell(e.row, e.col, e.raw);
  }

  getRaw(row: number, col: number): string {
    return this.cells.get(this.key(row, col))?.raw ?? '';
  }

  /** 解析非公式字面量为单元格值（特性 5） */
  private literalValue(raw: string): CellValue {
    if (raw === '') return EMPTY;
    const upper = raw.trim().toUpperCase();
    if (upper === 'TRUE') return bool(true);
    if (upper === 'FALSE') return bool(false);
    if (NUMBER_LITERAL_RE.test(raw.trim())) return num(Number(raw.trim()));
    return txt(raw);
  }

  recalc(): EngineSnapshot {
    const t0 = performance.now();

    // ---- 阶段 1：解析 -----------------------------------------------------
    const parsed = new Map<string, { cell: RawCell; ast?: A1Node; parseError?: { kind: ErrorKind; message: string; offset: number; length: number } }>();
    for (const [k, cell] of this.cells) {
      if (cell.raw.startsWith('=')) {
        const entry = this.astCache.get(cell.raw);
        if (entry.error) {
          parsed.set(k, {
            cell,
            parseError: {
              kind: entry.error.kind,
              message: entry.error.message,
              offset: entry.error.offset,
              length: entry.error.length,
            },
          });
        } else if (entry.ast) {
          parsed.set(k, { cell, ast: entry.ast });
        }
      } else {
        parsed.set(k, { cell });
      }
    }
    const t1 = performance.now();

    // ---- 阶段 2：构建依赖图 ----------------------------------------------
    const graph = new DependencyGraph();
    // 单元格级邻接（拓扑用，只统计已占用单元格）
    const cellDeps = new Map<string, Set<string>>();
    const cellDependents = new Map<string, Set<string>>();
    // 供 UI 高亮的依赖列表（包含指向空单元格的引用）
    const highlightDeps = new Map<string, string[]>();
    const depInfo = new Map<
      string,
      { deps: string[]; ranges: Array<{ label: string; members: string[] }> }
    >();

    const occupiedAddr = new Set<string>();
    for (const { row, col } of this.cells.values()) occupiedAddr.add(this.key(row, col));

    // 先登记所有 cell 节点
    for (const { row, col } of this.cells.values()) {
      graph.addNode({
        id: cellId(row, col),
        kind: 'cell',
        label: formatAddr({ row, col }),
        row,
        col,
      });
      cellDeps.set(cellId(row, col), new Set());
      cellDependents.set(cellId(row, col), new Set());
    }

    for (const [k, item] of parsed) {
      if (!item.ast) continue;
      const owner = cellId(item.cell.row, item.cell.col);
      const addr = formatAddr({ row: item.cell.row, col: item.cell.col });
      const fId = formulaId(addr);
      graph.addNode({ id: fId, kind: 'formula', label: item.cell.raw, ownerCell: owner });
      graph.addEdge(fId, owner); // 公式产出单元格的值

      const rawDeps = extractDependencies(item.ast);
      const ranges = extractRanges(item.ast);
      const depAddrs: string[] = [];
      const memberByRange = new Map<string, string[]>();

      for (const d of rawDeps) {
        const label = formatAddr(d.addr);
        depAddrs.push(label);
        const dId = cellId(d.addr.row, d.addr.col);
        if (occupiedAddr.has(this.key(d.addr.row, d.addr.col))) {
          cellDeps.get(owner)!.add(dId);
          if (!cellDependents.has(dId)) cellDependents.set(dId, new Set());
          cellDependents.get(dId)!.add(owner);
        }
      }
      highlightDeps.set(owner, depAddrs);

      // 区域节点：成员 cell -> range -> formula
      for (const r of ranges) {
        const rLabel = `${colToLetters(r.left)}${r.top + 1}:${colToLetters(r.right)}${r.bottom + 1}`;
        const rId = rangeId(rLabel);
        graph.addNode({ id: rId, kind: 'range', label: rLabel, ownerCell: owner });
        graph.addEdge(rId, fId);
        const members: string[] = [];
        for (let rr = r.top; rr <= r.bottom; rr++) {
          for (let cc = r.left; cc <= r.right; cc++) {
            members.push(formatAddr({ row: rr, col: cc }));
            if (occupiedAddr.has(this.key(rr, cc))) {
              graph.addEdge(cellId(rr, cc), rId);
            }
          }
        }
        memberByRange.set(rLabel, members);
      }

      // 单引用：dep cell -> formula
      for (const d of rawDeps) {
        if (d.source === 'ref') {
          const dId = cellId(d.addr.row, d.addr.col);
          if (this.cells.has(this.key(d.addr.row, d.addr.col))) {
            graph.addEdge(dId, fId);
          }
        }
      }
      // 区域内但未被上面覆盖的已占用成员边已加；区域外的散列引用无需连 range
      void memberByRange;
      depInfo.set(k, {
        deps: depAddrs,
        ranges: ranges.map((r) => {
          const label = `${colToLetters(r.left)}${r.top + 1}:${colToLetters(r.right)}${r.bottom + 1}`;
          return { label, members: memberByRange.get(label) ?? [] };
        }),
      });
    }
    const t2 = performance.now();

    // ---- 阶段 3：拓扑排序 + 循环检测 -------------------------------------
    const adj: AdjacencyInput = { deps: cellDeps, dependents: cellDependents };
    const ids = [...occupiedAddr].map((k) => {
      const [r, c] = k.split(',').map(Number);
      return cellId(r!, c!);
    });

    const report = detectCycles(ids, adj);
    const cyclicCells = report.cyclic;
    // 用去掉循环入边的图再做一次 Kahn，得到可求值节点的稳定顺序
    const prunedDeps = new Map<string, Set<string>>();
    for (const [id, set] of cellDeps) {
      prunedDeps.set(
        id,
        new Set([...set].filter((d) => !cyclicCells.has(d))),
      );
    }
    const prunedAdj: AdjacencyInput = { deps: prunedDeps, dependents: cellDependents };
    const safeTopo =
      this.topoAlgorithm === 'dfs'
        ? dfsTopo(
            ids.filter((id) => !cyclicCells.has(id)),
            prunedAdj,
          )
        : kahnTopo(
            ids.filter((id) => !cyclicCells.has(id)),
            prunedAdj,
          );
    const t3 = performance.now();

    // ---- 阶段 4：全量重算 ------------------------------------------------
    const values = new Map<string, CellValue>();
    // 循环节点预置 #CIRC!（特性 24）
    for (const id of cyclicCells) values.set(id, err('#CIRC!', '循环引用'));

    const evalContext: EvalContext = {
      getCell: (row, col) => values.get(cellId(row, col)) ?? EMPTY,
    };

    for (const id of safeTopo.order) {
      const { row: r, col: c } = parseCellId(id);
      const k = this.key(r, c);
      const item = parsed.get(k)!;
      if (item.parseError) {
        values.set(id, err(item.parseError.kind, item.parseError.message));
        continue;
      }
      if (item.ast) {
        values.set(
          id,
          evaluate(item.ast, evalContext, {
            registry: this.registry,
            maxRow: this.rows - 1,
            maxCol: this.cols - 1,
          }),
        );
      } else {
        values.set(id, this.literalValue(item.cell.raw));
      }
    }
    const t4 = performance.now();

    // ---- 阶段 5：组装快照 ------------------------------------------------
    const cellsOut: Record<string, ComputedCell> = {};
    const errors: ErrorEntry[] = [];
    for (const [k, item] of parsed) {
      const id = cellId(item.cell.row, item.cell.col);
      const addr = formatAddr({ row: item.cell.row, col: item.cell.col });
      const value = values.get(id) ?? EMPTY;
      const deps = highlightDeps.get(id) ?? depInfo.get(k)?.deps ?? [];
      const dependents = [...(cellDependents.get(id) ?? [])].map((d) => {
        const { row: r, col: c } = parseCellId(d);
        return formatAddr({ row: r, col: c });
      });
      const computed: ComputedCell = {
        row: item.cell.row,
        col: item.cell.col,
        raw: item.cell.raw,
        isFormula: item.cell.raw.startsWith('='),
        value,
        deps,
        dependents,
        ast: item.ast,
        parseError: item.parseError,
      };
      cellsOut[addr] = computed;
      if (value.type === 'error') {
        errors.push({
          address: addr,
          kind: value.kind,
          message: value.message ?? this.defaultMessage(value.kind),
          offset: item.parseError?.offset,
          length: item.parseError?.length,
        });
      }
    }

    // 重算顺序（特性 22、31）
    const order: RecalcOrderEntry[] = safeTopo.order.map((id, i) => {
      const { row: r, col: c } = parseCellId(id);
      const v = values.get(id);
      return {
        address: formatAddr({ row: r, col: c }),
        order: i,
        status: v?.type === 'error' ? 'error' : 'ok',
      };
    });
    for (const id of cyclicCells) {
      const { row: r, col: c } = parseCellId(id);
      order.push({
        address: formatAddr({ row: r, col: c }),
        order: order.length,
        status: 'circular',
      });
    }

    // 图布局：cell 层基于单元格邻接；formula / range 节点相对 owner 放置
    const cellLayout = layeredLayout(
      ids,
      adj,
      cyclicCells,
      { colWidth: 240, rowHeight: 60 },
    );
    const layout = new Map(cellLayout);
    for (const node of graph.nodes.values()) {
      if (node.kind === 'formula' && node.ownerCell) {
        const owner = cellLayout.get(node.ownerCell);
        if (owner) layout.set(node.id, { x: owner.x - 105, y: owner.y });
      } else if (node.kind === 'range' && node.ownerCell) {
        const owner = cellLayout.get(node.ownerCell);
        if (owner) {
          const idx = graph.inEdges.get(node.id)?.size ?? 0;
          layout.set(node.id, { x: owner.x - 200, y: owner.y + 22 + ((idx % 3) - 1) * 24 });
        }
      }
    }
    const graphSnapshot = graph.serialize(layout);
    // 循环图节点：cell + 其 formula
    const circularNodeIds = new Set<string>();
    for (const id of cyclicCells) {
      circularNodeIds.add(id);
      const { row: r, col: c } = parseCellId(id);
      circularNodeIds.add(formulaId(formatAddr({ row: r, col: c })));
    }

    return {
      cells: cellsOut,
      graph: graphSnapshot,
      order,
      errors: errors.sort((a, b) => a.address.localeCompare(b.address)),
      circularNodes: [...cyclicCells].map((id) => {
        const { row: r, col: c } = parseCellId(id);
        return formatAddr({ row: r, col: c });
      }),
      timing: {
        parseMs: t1 - t0,
        graphMs: t2 - t1,
        topoMs: t3 - t2,
        evalMs: t4 - t3,
        totalMs: t4 - t0,
      },
      debug: {
        astCacheSize: this.astCache.size,
        astCacheHits: this.astCache.hitCount,
        nodeCount: graph.nodeCount,
        edgeCount: graph.edgeCount,
        topoAlgorithm: this.topoAlgorithm,
        cycles: report.cycles,
        selfLoops: report.selfLoops,
        circularNodeIds: [...circularNodeIds],
      },
    };
  }

  private defaultMessage(kind: ErrorKind): string {
    switch (kind) {
      case '#DIV/0!':
        return '除数为零';
      case '#VALUE!':
        return '参数类型错误';
      case '#REF!':
        return '引用无效';
      case '#NAME?':
        return '名称无法识别';
      case '#N/A':
        return '值不可用';
      case '#CIRC!':
        return '循环引用';
    }
  }
}
