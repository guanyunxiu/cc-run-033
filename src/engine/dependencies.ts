/**
 * 从 AST 提取依赖引用（特性 19）。
 * 使用访问者模式遍历 AST，收集单元格引用与区域引用。
 */
import { AstNode, AstVisitor } from './ast';
import { canonicalAddress, CellAddress, rangeKey, RangeRef } from './a1';

export interface FormulaDependencies {
  /** 依赖的单个单元格地址（去重） */
  cells: CellAddress[];
  /** 依赖的区域（去重） */
  ranges: RangeRef[];
}

class ExtractVisitor implements AstVisitor<void> {
  readonly cellSet = new Set<string>();
  readonly rangeSet = new Set<string>();
  readonly cells: CellAddress[] = [];
  readonly ranges: RangeRef[] = [];

  visitNumber(): void {}
  visitString(): void {}
  visitBoolean(): void {}
  visitError(): void {}

  visitReference(node: ExtractNode<'reference'>): void {
    const key = canonicalAddress(node.ref);
    if (!this.cellSet.has(key)) {
      this.cellSet.add(key);
      this.cells.push({ col: node.ref.col, row: node.ref.row });
    }
  }

  visitRange(node: ExtractNode<'range'>): void {
    const key = rangeKey(node.range);
    if (!this.rangeSet.has(key)) {
      this.rangeSet.add(key);
      this.ranges.push(node.range);
    }
  }

  visitUnary(node: ExtractNode<'unary'>): void {
    dispatch(node.operand, this);
  }

  visitBinary(node: ExtractNode<'binary'>): void {
    dispatch(node.left, this);
    dispatch(node.right, this);
  }

  visitFunction(node: ExtractNode<'function'>): void {
    for (const arg of node.args) dispatch(arg, this);
  }
}

// 访问者参数与 AstNode 做窄化的小工具类型（visit* 只接收对应节点）
type ExtractNode<K extends AstNode['type']> = Extract<AstNode, { type: K }>;

import { visitAst } from './ast';
function dispatch(node: AstNode, v: ExtractVisitor): void {
  visitAst(node, v);
}

export function extractDependencies(ast: AstNode): FormulaDependencies {
  const visitor = new ExtractVisitor();
  visitAst(ast, visitor);
  return { cells: visitor.cells, ranges: visitor.ranges };
}
