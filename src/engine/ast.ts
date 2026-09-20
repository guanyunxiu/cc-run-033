/**
 * 公式 AST 节点定义（特性 10）。
 * 每个节点携带源偏移，用于语法错误定位（特性 11）与高亮。
 */
import type { CellRef, RangeRef } from './a1';
import type { ErrorCode } from './errors';

export interface NodePosition {
  /** 公式正文中的起始偏移（不含前导 =） */
  offset: number;
  length: number;
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

export type UnaryOperator = '+' | '-' | '%';

export type AstNode =
  | NumberNode
  | StringNode
  | BooleanNode
  | ErrorNode
  | ReferenceNode
  | RangeNode
  | UnaryNode
  | BinaryNode
  | FunctionNode;

export interface AstBase {
  pos: NodePosition;
}

export interface NumberNode extends AstBase {
  type: 'number';
  value: number;
}

export interface StringNode extends AstBase {
  type: 'string';
  value: string;
}

export interface BooleanNode extends AstBase {
  type: 'boolean';
  value: boolean;
}

export interface ErrorNode extends AstBase {
  type: 'error';
  code: ErrorCode;
}

export interface ReferenceNode extends AstBase {
  type: 'reference';
  ref: CellRef;
  /** 原始文本，保留 $ 形式 */
  text: string;
}

export interface RangeNode extends AstBase {
  type: 'range';
  range: RangeRef;
  text: string;
}

export interface UnaryNode extends AstBase {
  type: 'unary';
  operator: UnaryOperator;
  operand: AstNode;
  /** percent 是后缀，+/- 是前缀 */
  postfix: boolean;
}

export interface BinaryNode extends AstBase {
  type: 'binary';
  operator: BinaryOperator;
  left: AstNode;
  right: AstNode;
}

export interface FunctionNode extends AstBase {
  type: 'function';
  name: string;
  args: AstNode[];
}

/** 访问者模式（技术点 9） */
export interface AstVisitor<T> {
  visitNumber(node: NumberNode): T;
  visitString(node: StringNode): T;
  visitBoolean(node: BooleanNode): T;
  visitError(node: ErrorNode): T;
  visitReference(node: ReferenceNode): T;
  visitRange(node: RangeNode): T;
  visitUnary(node: UnaryNode): T;
  visitBinary(node: BinaryNode): T;
  visitFunction(node: FunctionNode): T;
}

export function visitAst<T>(node: AstNode, visitor: AstVisitor<T>): T {
  switch (node.type) {
    case 'number':
      return visitor.visitNumber(node);
    case 'string':
      return visitor.visitString(node);
    case 'boolean':
      return visitor.visitBoolean(node);
    case 'error':
      return visitor.visitError(node);
    case 'reference':
      return visitor.visitReference(node);
    case 'range':
      return visitor.visitRange(node);
    case 'unary':
      return visitor.visitUnary(node);
    case 'binary':
      return visitor.visitBinary(node);
    case 'function':
      return visitor.visitFunction(node);
  }
}

/** AST -> 可读树形文本（特性 12，供 AST 面板展示）。 */
export function astToTreeText(node: AstNode, indent = 0): string {
  const pad = '  '.repeat(indent);
  const head = (label: string): string => `${pad}${label}`;
  switch (node.type) {
    case 'number':
      return head(`Number ${node.value}`);
    case 'string':
      return head(`String "${node.value}"`);
    case 'boolean':
      return head(`Boolean ${node.value}`);
    case 'error':
      return head(`Error ${node.code}`);
    case 'reference':
      return head(`Reference ${node.text}`);
    case 'range':
      return head(`Range ${node.text}`);
    case 'unary':
      return [
        head(`Unary ${node.operator}${node.postfix ? '(postfix)' : ''}`),
        astToTreeText(node.operand, indent + 1),
      ].join('\n');
    case 'binary':
      return [
        head(`Binary ${node.operator}`),
        astToTreeText(node.left, indent + 1),
        astToTreeText(node.right, indent + 1),
      ].join('\n');
    case 'function':
      return [
        head(`Function ${node.name} (${node.args.length} args)`),
        ...node.args.map((a) => astToTreeText(a, indent + 1)),
      ].join('\n');
  }
}
