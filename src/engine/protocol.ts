/**
 * Worker <-> 主线程消息协议与快照序列化（特性 34、35，技术点 5）。
 * Worker 负责解析、求值、依赖图、重算；主线程只做 UI 与 SVG 渲染。
 */
import type { RecalcResult } from './workbook';
import type { ErrorCode } from './errors';

export interface CellSnapshot {
  key: string;
  col: number;
  row: number;
  raw: string;
  status: 'empty' | 'literal' | 'formula' | 'parse-error';
  display: string;
  valueType: 'empty' | 'number' | 'text' | 'boolean' | 'error';
  errorCode: ErrorCode | null;
  formulaText: string | null;
  parseError: { message: string; offset: number; length: number; column: number } | null;
  astTree: string | null;
  cyclic: boolean;
}

export interface GraphNodeSnapshot {
  id: string;
  kind: 'cell' | 'formula' | 'range';
  label: string;
  col: number;
  row: number;
  owner: string | null;
}

export interface GraphEdgeSnapshot {
  from: string;
  to: string;
  reason: 'owns' | 'references-cell' | 'references-range' | 'covers';
}

export interface CycleSnapshot {
  kind: 'self' | 'direct' | 'indirect';
  path: string[];
  members: string[];
}

export interface Snapshot {
  cells: Record<string, CellSnapshot>;
  nodes: GraphNodeSnapshot[];
  edges: GraphEdgeSnapshot[];
  order: { key: string; index: number; kind: 'formula' | 'cycle'; detail: string }[];
  cycles: CycleSnapshot[];
  errors: { key: string; code: string; message: string; raw: string; source: 'formula' | 'value' }[];
  formulaDeps: Record<
    string,
    { cells: { col: number; row: number }[]; ranges: { text: string }[] }
  >;
  algorithm: 'kahn' | 'dfs';
  stats: {
    cellCount: number;
    formulaCount: number;
    nodeCount: number;
    edgeCount: number;
    recalcMs: number;
  };
}

export type WorkerRequest =
  | { type: 'setCell'; col: number; row: number; raw: string }
  | { type: 'setCells'; entries: { col: number; row: number; raw: string }[] }
  | { type: 'clear' }
  | { type: 'setAlgorithm'; algorithm: 'kahn' | 'dfs' }
  | { type: 'parsePreview'; body: string; reqId: number };

export type WorkerResponse =
  | { type: 'snapshot'; snapshot: Snapshot }
  | {
      type: 'parsePreview';
      reqId: number;
      astTree: string | null;
      error: { message: string; offset: number; length: number; column: number } | null;
    };

export function serializeResult(result: RecalcResult, recalcMs: number): Snapshot {
  const cells: Record<string, CellSnapshot> = {};
  let formulaCount = 0;
  for (const [key, info] of result.cells) {
    if (info.formulaText) formulaCount++;
    cells[key] = {
      key,
      col: info.col,
      row: info.row,
      raw: info.raw,
      status: info.status,
      display: info.display,
      valueType: info.value.kind,
      errorCode: info.value.kind === 'error' ? info.value.code : null,
      formulaText: info.formulaText,
      parseError: info.parseError,
      astTree: info.astTree,
      cyclic: info.cyclic,
    };
  }

  const nodes: GraphNodeSnapshot[] = [...result.graph.nodes.values()].map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    col: n.cell?.col ?? -1,
    row: n.cell?.row ?? -1,
    owner: n.owner ?? null,
  }));

  return {
    cells,
    nodes,
    edges: result.graph.edges.map((e) => ({ from: e.from, to: e.to, reason: e.reason })),
    order: result.order,
    cycles: result.cycles,
    errors: result.errors,
    formulaDeps: Object.fromEntries(result.formulaDeps),
    algorithm: result.algorithm,
    stats: {
      cellCount: result.cells.size,
      formulaCount,
      nodeCount: nodes.length,
      edgeCount: result.graph.edges.length,
      recalcMs,
    },
  };
}
