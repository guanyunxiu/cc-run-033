/**
 * AST 访问者模式（技术 9）。
 *
 * 任意对 AST 的遍历操作（依赖提取、求值、序列化展示）都可实现该接口，
 * 由 walkAst 统一驱动，避免在多处重复 switch。
 */
import type { A1Node } from './types.js';

export interface AstVisitor<T> {
  visitNumber(node: Extract<A1Node, { kind: 'number' }>): T;
  visitText(node: Extract<A1Node, { kind: 'text' }>): T;
  visitBoolean(node: Extract<A1Node, { kind: 'boolean' }>): T;
  visitRef(node: Extract<A1Node, { kind: 'ref' }>): T;
  visitRange(node: Extract<A1Node, { kind: 'range' }>): T;
  visitUnary(node: Extract<A1Node, { kind: 'unary' }>, operand: T): T;
  visitPercent(node: Extract<A1Node, { kind: 'percent' }>, operand: T): T;
  visitBinary(
    node: Extract<A1Node, { kind: 'binary' }>,
    left: T,
    right: T,
  ): T;
  visitFunction(node: Extract<A1Node, { kind: 'function' }>, args: T[]): T;
  visitNameError(node: Extract<A1Node, { kind: 'nameError' }>): T;
}

export function walkAst<T>(node: A1Node, v: AstVisitor<T>): T {
  switch (node.kind) {
    case 'number':
      return v.visitNumber(node);
    case 'text':
      return v.visitText(node);
    case 'boolean':
      return v.visitBoolean(node);
    case 'ref':
      return v.visitRef(node);
    case 'range':
      return v.visitRange(node);
    case 'unary':
      return v.visitUnary(node, walkAst(node.operand, v));
    case 'percent':
      return v.visitPercent(node, walkAst(node.operand, v));
    case 'binary':
      return v.visitBinary(node, walkAst(node.left, v), walkAst(node.right, v));
    case 'function':
      return v.visitFunction(
        node,
        node.args.map((a) => walkAst(a, v)),
      );
    case 'nameError':
      return v.visitNameError(node);
  }
}
