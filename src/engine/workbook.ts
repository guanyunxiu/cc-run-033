/**
 * Workbook：引擎编排层。
 *
 * 职责：
 *  - 保存单元格原始输入（文本）；
 *  - 原始文本 -> 字面值（数字/文本/布尔/空/错误）或公式 AST；
 *  - AST 缓存（技术点 10）：按原始公式文本缓存解析结果；
 *  - 构建依赖图（cell / formula / range 三类节点）；
 *  - 全量重算（特性 21）：压缩到单元格级图 -> Kahn 拓扑排序 -> 顺序求值；
 *  - 循环检测（特性 23、24）：环上公式结果为 #CYCLE!，下游正常传播。
 */
import { AstNode, astToTreeText } from './ast';
import { canonicalAddress, CellAddress, expandRange } from './a1';
import { extractDependencies } from './dependencies';
import { EvalError, errorMessage } from './errors';
import { evaluateAst } from './evaluator';
import {
  cellId,
  DependencyGraph,
  formulaId,
  GraphEdge,
  rangeId,
} from './graph';
import { createBuiltinRegistry, FunctionRegistry } from './functions';
import { ParseError, Parser } from './parser';
import { dfsTopSortWithCycles, kahnTopSort, classifyCycle } from './topology';
import { errVal, formatValue, ScalarValue } from './value';

export interface RawCell {
  raw: string;
}

export type ParseStatus = 'empty' | 'literal' | 'formula' | 'parse-error';

export interface CellInfo {
  key: string;
  col: number;
  row: number;
  raw: string;
  status: ParseStatus;
  value: ScalarValue;
  display: string;
  formulaText: string | null;
  parseError: { message: string; offset: number; length: number; column: number } | null;
  astTree: string | null;
  cyclic: boolean;
}

export interface RecalcOrderEntry {
  key: string;
  index: number;
  kind: 'formula' | 'cycle';
  detail: string;
}

export interface ErrorListItem {
  key: string;
  code: string;
  message: string;
  raw: string;
  source: 'formula' | 'value';
}

export interface CycleInfo {
  kind: 'self' | 'direct' | 'indirect';
  path: string[];
  members: string[];
}

export interface RecalcResult {
  cells: Map<string, CellInfo>;
  graph: DependencyGraph;
  order: RecalcOrderEntry[];
  cycles: CycleInfo[];
  errors: ErrorListItem[];
  /** 每个公式单元格的依赖（网格高亮/调试用） */
  formulaDeps: Map<string, { cells: { col: number; row: number }[]; ranges: { text: string }[] }>;
  algorithm: 'kahn' | 'dfs';
}

interface CacheEntry {
  ast: AstNode | null;
  error: ParseError | null;
}

export class Workbook {
  private rawCells = new Map<string, RawCell>();
  /** AST 缓存：公式正文 -> 解析结果 */
  private readonly astCache = new Map<string, CacheEntry>();
  private registry: FunctionRegistry = createBuiltinRegistry();
  private algorithm: 'kahn' | 'dfs' = 'kahn';

  setRegistry(registry: FunctionRegistry): void {
    this.registry = registry;
  }

  setAlgorithm(algorithm: 'kahn' | 'dfs'): void {
    this.algorithm = algorithm;
  }

  setCell(col: number, row: number, raw: string): void {
    const key = canonicalAddress({ col, row });
    if (raw === '') this.rawCells.delete(key);
    else this.rawCells.set(key, { raw });
  }

  getRaw(key: string): string {
    return this.rawCells.get(key)?.raw ?? '';
  }

  rawEntries(): [string, RawCell][] {
    return [...this.rawCells.entries()];
  }

  clear(): void {
    this.rawCells.clear();
  }

  /** 解析公式正文（带缓存）。 */
  parseFormulaBody(body: string): CacheEntry {
    const cached = this.astCache.get(body);
    if (cached) return cached;
    const { ast, error } = Parser.parseFormula(body);
    const entry: CacheEntry = { ast, error };
    this.astCache.set(body, entry);
    return entry;
  }

  /** 非公式原始文本 -> 标量值。 */
  static parseLiteral(raw: string): ScalarValue {
    const text = raw.trim();
    if (text === '') return { kind: 'empty' };
    const upper = text.toUpperCase();
    if (upper === 'TRUE') return { kind: 'boolean', value: true };
    if (upper === 'FALSE') return { kind: 'boolean', value: false };
    if (
      upper === '#DIV/0!' ||
      upper === '#VALUE!' ||
      upper === '#REF!' ||
      upper === '#NAME?' ||
      upper === '#N/A'
    ) {
      return { kind: 'error', code: upper };
    }
    const n = Number(text);
    if (text !== '' && !Number.isNaN(n)) return { kind: 'number', value: n };
    return { kind: 'text', value: raw };
  }

  recalc(): RecalcResult {
    const values = new Map<string, ScalarValue>();
    const infoMap = new Map<string, CellInfo>();
    const formulaDeps = new Map<
      string,
      { cells: { col: number; row: number }[]; ranges: { text: string }[] }
    >();
    const errors: ErrorListItem[] = [];

    const getValue = (col: number, row: number): ScalarValue =>
      values.get(canonicalAddress({ col, row })) ?? { kind: 'empty' };

    /* 1. 解析全部单元格：字面值直接入表，公式收集 */
    const formulaOwners = new Set<string>();
    for (const [key, { raw }] of this.rawCells) {
      if (raw.startsWith('=')) {
        formulaOwners.add(key);
        continue;
      }
      const value = Workbook.parseLiteral(raw);
      values.set(key, value);
    }

    /* 2. 解析公式（缓存命中），建立依赖图 */
    const graph = new DependencyGraph();
    const ownerAST = new Map<string, AstNode>();
    const parseErrorByOwner = new Map<string, ParseError>();

    // 先为所有出现过的单元格建 cell 节点（含区域覆盖到的空单元格）
    const ensureCellNode = (col: number, row: number): string => {
      const addr: CellAddress = { col, row };
      const id = cellId(addr);
      if (!graph.nodes.has(id)) {
        graph.addNode({
          id,
          kind: 'cell',
          label: canonicalAddress(addr),
          cell: addr,
        });
      }
      return id;
    };

    for (const key of this.rawCells.keys()) ensureCellNode(parseKey(key).col, parseKey(key).row);

    for (const key of formulaOwners) {
      const addr = parseKey(key);
      const raw = this.rawCells.get(key)!.raw;
      const body = raw.slice(1);
      const ownerCellId = ensureCellNode(addr.col, addr.row);
      const fId = formulaId(addr);
      graph.addNode({ id: fId, kind: 'formula', label: `ƒ(${key})`, owner: key, cell: addr });
      graph.addEdge({ from: ownerCellId, to: fId, reason: 'owns' });

      const parsed = this.parseFormulaBody(body);
      if (parsed.error || !parsed.ast) {
        parseErrorByOwner.set(key, parsed.error ?? new ParseError('解析失败', 0, 1, 1));
        values.set(key, errVal('#NAME?'));
        continue;
      }
      ownerAST.set(key, parsed.ast);

      const deps = extractDependencies(parsed.ast);
      formulaDeps.set(key, {
        cells: deps.cells.map((c) => ({ col: c.col, row: c.row })),
        ranges: deps.ranges.map((r) => ({
          text: `${canonicalAddress(r.start)}:${canonicalAddress(r.end)}`,
        })),
      });

      for (const c of deps.cells) {
        const targetId = ensureCellNode(c.col, c.row);
        graph.addEdge({ from: fId, to: targetId, reason: 'references-cell' });
      }
      for (const r of deps.ranges) {
        const rgId = rangeId(key, r);
        graph.addNode({
          id: rgId,
          kind: 'range',
          label: `${canonicalAddress(r.start)}:${canonicalAddress(r.end)}`,
          range: r,
          owner: key,
        });
        graph.addEdge({ from: fId, to: rgId, reason: 'references-range' });
        for (const member of expandRange(r)) {
          const memberId = ensureCellNode(member.col, member.row);
          graph.addEdge({ from: rgId, to: memberId, reason: 'covers' });
        }
      }
    }

    /* 3. 单元格级压缩图 + 拓扑排序 */
    const { out, incoming } = graph.compressedCellEdges();
    let orderKeys: string[];
    let cyclicKeys: Set<string>;
    let blockedKeys: Set<string>;
    let cycles: CycleInfo[];

    const toCycleInfos = (paths: string[][]): CycleInfo[] =>
      paths.map((p) => ({
        kind: classifyCycle(p),
        path: p,
        members: [...new Set(p)],
      }));

    if (this.algorithm === 'kahn') {
      const result = kahnTopSort(out, incoming);
      orderKeys = result.order;
      cyclicKeys = result.cyclicNodes;
      blockedKeys = result.blockedNodes;
      // Kahn 不直接给环路径：再跑一次 DFS 仅用于展示
      cycles = toCycleInfos(dfsTopSortWithCycles(out).cycles);
    } else {
      const dfs = dfsTopSortWithCycles(out);
      orderKeys = dfs.order;
      cyclicKeys = dfs.cyclicNodes;
      blockedKeys = dfs.blockedNodes;
      cycles = toCycleInfos(dfs.cycles);
    }

    const asFormulaKeys = (ids: Set<string>): Set<string> =>
      new Set(
        [...ids]
          .filter((id) => id.startsWith('cell:'))
          .map((id) => id.slice('cell:'.length))
          .filter((key) => formulaOwners.has(key)),
      );

    // 仅“含公式且在环上”的单元格标记为循环
    const cyclicFormulaKeys = asFormulaKeys(cyclicKeys);
    // 不在环上但依赖环的公式：先写 #CYCLE! 占位，随后正常求值以实现错误传播
    const blockedFormulaKeys = asFormulaKeys(blockedKeys);

    /* 4. 循环单元格直接写入 #CYCLE!（特性 24） */
    for (const key of cyclicFormulaKeys) {
      values.set(key, errVal('#CYCLE!'));
    }

    /* 5. 按拓扑顺序求值（特性 21、22） */
    const orderEntries: RecalcOrderEntry[] = [];
    let index = 0;

    const evaluateOne = (key: string, kind: 'formula' | 'cycle'): void => {
      const ast = ownerAST.get(key);
      let value: ScalarValue;
      if (kind === 'cycle' || !ast) {
        value = errVal('#CYCLE!');
      } else {
        try {
          value = evaluateAst(
            ast,
            (col, row) => getValue(col, row),
            this.registry,
          );
        } catch (e) {
          value = e instanceof EvalError ? errVal(e.code) : errVal('#VALUE!');
        }
      }
      values.set(key, value);
      orderEntries.push({
        key,
        index: index++,
        kind,
        detail: `${this.rawCells.get(key)!.raw}  =>  ${formatValue(value)}`,
      });
    };

    for (const id of orderKeys) {
      if (!id.startsWith('cell:')) continue;
      const key = id.slice('cell:'.length);
      if (!formulaOwners.has(key)) continue;
      if (cyclicFormulaKeys.has(key) || blockedFormulaKeys.has(key)) continue;
      evaluateOne(key, 'formula');
    }

    // 被环阻塞的公式：此时环上节点已是 #CYCLE!，逐个求值即可让错误值
    // 沿普通运算/函数语义继续传播（特性 24、26）。
    const blockedQueue = [...blockedFormulaKeys];
    while (blockedQueue.length) {
      blockedQueue.sort();
      const key = blockedQueue.shift()!;
      evaluateOne(key, 'formula');
    }

    for (const key of cyclicFormulaKeys) {
      orderEntries.push({
        key,
        index: index++,
        kind: 'cycle',
        detail: `${this.rawCells.get(key)!.raw}  =>  #CYCLE!`,
      });
    }

    /* 6. 汇总 CellInfo 与错误列表 */
    const allKeys = new Set<string>([...this.rawCells.keys(), ...values.keys()]);
    for (const key of allKeys) {
      const raw = this.rawCells.get(key)?.raw ?? '';
      const value = values.get(key) ?? { kind: 'empty' as const };
      const addr = parseKey(key);
      const isFormula = formulaOwners.has(key);
      const parseError = parseErrorByOwner.get(key) ?? null;
      const astNode = ownerAST.get(key) ?? null;

      let status: ParseStatus = 'empty';
      if (raw !== '' && !isFormula) status = 'literal';
      else if (isFormula) status = parseError ? 'parse-error' : 'formula';

      if (value.kind === 'error') {
        errors.push({
          key,
          code: value.code,
          message: errorMessage(value.code),
          raw,
          source: isFormula ? 'formula' : 'value',
        });
      }

      infoMap.set(key, {
        key,
        col: addr.col,
        row: addr.row,
        raw,
        status,
        value,
        display: formatValue(value),
        formulaText: isFormula ? raw : null,
        parseError: parseError
          ? {
              message: parseError.message,
              offset: parseError.offset,
              length: parseError.length,
              column: parseError.column,
            }
          : null,
        astTree: astNode ? astToTreeText(astNode) : null,
        cyclic: cyclicFormulaKeys.has(key),
      });
    }

    return {
      cells: infoMap,
      graph,
      order: orderEntries,
      cycles: cycles.filter((c) =>
        c.members.some((m) => m.startsWith('cell:') && formulaOwners.has(m.slice(5))),
      ),
      errors,
      formulaDeps,
      algorithm: this.algorithm,
    };
  }
}

/* 地址键解析（canonicalAddress 的逆运算） */
export function parseKey(key: string): CellAddress {
  const m = /^([A-Z]+)([0-9]+)$/.exec(key);
  if (!m) throw new Error(`非法单元格键: ${key}`);
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2]!, 10) - 1 };
}

export type { GraphEdge };
