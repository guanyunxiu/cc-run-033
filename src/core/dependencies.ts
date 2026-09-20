/**
 * 从 AST 提取依赖引用（特性 19），并完成基础引用解析与区域展开（特性 13、14）。
 */
import type { A1Node } from './types.js';
import { walkAst, type AstVisitor } from './visitor.js';
import { expandRect, formatAddr, normalizeRect, type CellAddr } from './address.js';

export interface RawDependency {
  /** 依赖指向的单元格地址（区域会展开为多个） */
  addr: CellAddr;
  /** 依赖来自 AST 中的位置 */
  source: 'ref' | 'range';
  /** 若是区域依赖，记录区域锚点地址字符串 */
  range?: string;
}

class DependencyExtractor implements AstVisitor<void> {
  readonly deps: RawDependency[] = [];
  private readonly seen = new Set<string>();

  private add(addr: CellAddr, source: 'ref' | 'range', range?: string): void {
    const key = `${addr.row}:${addr.col}:${range ?? ''}`;
    if (!this.seen.has(key)) {
      this.seen.add(key);
      this.deps.push({ addr, source, range });
    }
  }

  visitNumber(): void {}
  visitText(): void {}
  visitBoolean(): void {}
  visitNameError(): void {}

  visitRef(node: Extract<A1Node, { kind: 'ref' }>): void {
    this.add({ row: node.row, col: node.col }, 'ref');
  }

  visitRange(node: Extract<A1Node, { kind: 'range' }>): void {
    const rect = normalizeRect(
      { row: node.start.row, col: node.start.col },
      { row: node.end.row, col: node.end.col },
    );
    const rangeLabel = `${formatAddr({ row: rect.top, col: rect.left })}:${formatAddr({
      row: rect.bottom,
      col: rect.right,
    })}`;
    for (const addr of expandRect(rect)) {
      this.add(addr, 'range', rangeLabel);
    }
  }

  visitUnary(): void {}
  visitPercent(): void {}
  visitBinary(): void {}
  visitFunction(): void {}
}

/** 提取 AST 中所有被引用单元格（区域已展开，去重） */
export function extractDependencies(ast: A1Node): RawDependency[] {
  const v = new DependencyExtractor();
  walkAst(ast, v);
  return v.deps;
}

/** 仅提取区域节点（不展开），供依赖图的 range 节点使用 */
export interface RangeRef {
  label: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

class RangeExtractor implements AstVisitor<void> {
  readonly ranges: RangeRef[] = [];
  visitNumber(): void {}
  visitText(): void {}
  visitBoolean(): void {}
  visitRef(): void {}
  visitNameError(): void {}
  visitUnary(): void {}
  visitPercent(): void {}
  visitBinary(): void {}
  visitFunction(): void {}
  visitRange(node: Extract<A1Node, { kind: 'range' }>): void {
    const rect = normalizeRect(
      { row: node.start.row, col: node.start.col },
      { row: node.end.row, col: node.end.col },
    );
    this.ranges.push({
      label: `${formatAddr({ row: rect.top, col: rect.left })}:${formatAddr({
        row: rect.bottom,
        col: rect.right,
      })}`,
      ...rect,
    });
  }
}

export function extractRanges(ast: A1Node): RangeRef[] {
  const v = new RangeExtractor();
  walkAst(ast, v);
  return v.ranges;
}
