/**
 * 全局核心类型定义。
 */

/** 电子表格错误类型（特性 25） */
export type ErrorKind =
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#N/A'
  | '#CIRC!';

/** 公式解析错误（语法错误，带定位） */
export class FormulaError extends Error {
  readonly kind: ErrorKind;
  /** 0-based 在源码中的字符偏移 */
  readonly offset: number;
  /** 错误覆盖长度 */
  readonly length: number;

  constructor(kind: ErrorKind, message: string, offset = 0, length = 1) {
    super(message);
    this.name = 'FormulaError';
    this.kind = kind;
    this.offset = offset;
    this.length = length;
  }
}

/** 单元格值类型（特性 5） */
export type CellValue =
  | { type: 'number'; value: number }
  | { type: 'text'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'empty' }
  | { type: 'error'; kind: ErrorKind; message?: string };

export const EMPTY: CellValue = { type: 'empty' };

export function num(value: number): CellValue {
  return { type: 'number', value };
}
export function txt(value: string): CellValue {
  return { type: 'text', value };
}
export function bool(value: boolean): CellValue {
  return { type: 'boolean', value };
}
export function err(kind: ErrorKind, message?: string): CellValue {
  return { type: 'error', kind, message };
}

export function isError(v: CellValue): v is Extract<CellValue, { type: 'error' }> {
  return v.type === 'error';
}

/** 网格尺寸 */
export interface GridSize {
  rows: number;
  cols: number;
}

/** 依赖图节点类型（特性 16） */
export type GraphNodeKind = 'cell' | 'formula' | 'range';

/** 依赖图边类型（特性 17） */
export type GraphEdgeKind = 'depends' | 'depended-by';

/** 序列化后的依赖图节点（供主线程 SVG 渲染） */
export interface SerializedNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** 布局坐标（Worker 计算分层布局后填充） */
  x: number;
  y: number;
}

/** 序列化后的依赖图边 */
export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  /** target 依赖 source，即 source -> target */
  kind: GraphEdgeKind;
}

/** 依赖图快照 */
export interface GraphSnapshot {
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

/** 计算后的单元格结果 */
export interface ComputedCell {
  row: number;
  col: number;
  /** 原始输入（用户键入内容） */
  raw: string;
  isFormula: boolean;
  value: CellValue;
  /** 直接上游单元格地址 */
  deps: string[];
  /** 直接下游单元格地址（逆邻接） */
  dependents: string[];
  /** 公式 AST（仅公式且解析成功时） */
  ast?: A1Node;
  /** 解析错误信息（仅公式） */
  parseError?: { kind: ErrorKind; message: string; offset: number; length: number };
}

export interface ErrorEntry {
  address: string;
  kind: ErrorKind;
  message: string;
  /** parse 错误时的源码偏移定位 */
  offset?: number;
  length?: number;
}

/** 重算顺序条目（特性 22、31） */
export interface RecalcOrderEntry {
  address: string;
  order: number;
  status: 'ok' | 'error' | 'circular';
}

/** 引擎快照：Worker -> 主线程 */
export interface EngineSnapshot {
  cells: Record<string, ComputedCell>;
  graph: GraphSnapshot;
  order: RecalcOrderEntry[];
  errors: ErrorEntry[];
  circularNodes: string[];
  timing: {
    parseMs: number;
    graphMs: number;
    topoMs: number;
    evalMs: number;
    totalMs: number;
  };
  /** 基础调试面板数据（特性 33） */
  debug: SnapshotDebug;
}

export interface SnapshotDebug {
  astCacheSize: number;
  astCacheHits: number;
  nodeCount: number;
  edgeCount: number;
  topoAlgorithm: 'kahn' | 'dfs';
  /** detectCycles 找到的回边路径 */
  cycles: string[][];
  selfLoops: string[];
  /** 图节点 id 层面的循环节点（cell + formula） */
  circularNodeIds: string[];
}

// ---------------------------------------------------------------------------
// AST 类型（特性 10）
// ---------------------------------------------------------------------------

export interface Position {
  /** 起始字符偏移（含） */
  start: number;
  /** 结束字符偏移（不含） */
  end: number;
}

export type A1Node =
  | NumberNode
  | TextNode
  | BoolNode
  | RefNode
  | RangeNode
  | UnaryNode
  | BinaryNode
  | PercentNode
  | FunctionNode
  | ErrorNode;

export interface NumberNode {
  kind: 'number';
  value: number;
  pos: Position;
}
export interface TextNode {
  kind: 'text';
  value: string;
  pos: Position;
}
export interface BoolNode {
  kind: 'boolean';
  value: boolean;
  pos: Position;
}
/** 单元格引用：A1 或 $A$1（特性 6） */
export interface RefNode {
  kind: 'ref';
  col: number;
  row: number;
  absoluteCol: boolean;
  absoluteRow: boolean;
  pos: Position;
}
/** 区域引用 A1:B10（特性 7） */
export interface RangeNode {
  kind: 'range';
  start: RefNode;
  end: RefNode;
  pos: Position;
}
export interface UnaryNode {
  kind: 'unary';
  operator: '-' | '+';
  operand: A1Node;
  pos: Position;
}
export interface PercentNode {
  kind: 'percent';
  operand: A1Node;
  pos: Position;
}
export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '&'
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>=';
export interface BinaryNode {
  kind: 'binary';
  operator: BinaryOperator;
  left: A1Node;
  right: A1Node;
  pos: Position;
}
export interface FunctionNode {
  kind: 'function';
  name: string;
  args: A1Node[];
  pos: Position;
}
/** #NAME? 等无法识别的裸标识符（特性 11/25） */
export interface ErrorNode {
  kind: 'nameError';
  name: string;
  pos: Position;
}

/** Token（特性 8） */
export type TokenType =
  | 'number'
  | 'string'
  | 'ref'
  | 'ident'
  | 'bool'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'percent'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}
