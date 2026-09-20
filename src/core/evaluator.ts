/**
 * 公式求值器：遍历 AST 得到 CellValue。
 *
 * - 错误传播（特性 26）：任何操作数为错误值时直接向上传播
 * - 越界引用 => #REF!
 * - 区域作为函数参数时展开为数组
 * - IF 惰性求值（条件为常量时不求值未命中分支）
 */
import {
  EMPTY,
  err,
  type A1Node,
  type BinaryOperator,
  type CellValue,
} from './types.js';
import { walkAst, type AstVisitor } from './visitor.js';
import { expandRect, normalizeRect } from './address.js';
import {
  createBuiltinRegistry,
  type ArgValue,
  type EvalContext,
  type FunctionRegistry,
} from './functions.js';

export interface EvaluatorOptions {
  registry?: FunctionRegistry;
  /** 网格边界（越界引用报 #REF!） */
  maxRow: number;
  maxCol: number;
}

/** 将值强制转为数字（文本不可转换 => #VALUE!） */
function toNumber(v: CellValue): number {
  switch (v.type) {
    case 'number':
      return v.value;
    case 'boolean':
      return v.value ? 1 : 0;
    case 'empty':
      return 0;
    case 'text': {
      const t = v.value.trim();
      if (t === '') return 0;
      const n = Number(t);
      if (Number.isNaN(n)) {
        throw new EvalFlow(err('#VALUE!', `无法将文本 "${v.value}" 转为数字`));
      }
      return n;
    }
    case 'error':
      throw new EvalFlow(v);
  }
}

function toText(v: CellValue): string {
  switch (v.type) {
    case 'text':
      return v.value;
    case 'number':
      return String(v.value);
    case 'boolean':
      return v.value ? 'TRUE' : 'FALSE';
    case 'empty':
      return '';
    case 'error':
      throw new EvalFlow(v);
  }
}

/** 用异常在 visitor 中快速传播错误 */
class EvalFlow {
  constructor(readonly value: CellValue) {}
}

function compare(op: BinaryOperator, a: CellValue, b: CellValue): boolean {
  // 任意一端是文本 => 文本比较
  const aText = a.type === 'text';
  const bText = b.type === 'text';
  // 两端都不是数字（布尔/空/文本，且无文本）=> 按逻辑值比较
  const aBoolish = a.type === 'boolean' || a.type === 'empty';
  const bBoolish = b.type === 'boolean' || b.type === 'empty';

  if (!aText && !bText && (aBoolish && bBoolish)) {
    const x = a.type === 'boolean' ? a.value : false;
    const y = b.type === 'boolean' ? b.value : false;
    switch (op) {
      case '=':
        return x === y;
      case '<>':
        return x !== y;
      case '<':
        return x < y;
      case '<=':
        return x <= y;
      case '>':
        return x > y;
      case '>=':
        return x >= y;
      default:
        return false;
    }
  }

  // 至少一端是数字且另一端非文本 => 数字比较
  if (!aText && !bText && (a.type === 'number' || b.type === 'number')) {
    const x = toNumber(a);
    const y = toNumber(b);
    switch (op) {
      case '=':
        return x === y;
      case '<>':
        return x !== y;
      case '<':
        return x < y;
      case '<=':
        return x <= y;
      case '>':
        return x > y;
      case '>=':
        return x >= y;
      default:
        return false;
    }
  }
  // 文本比较
  const x = toText(a);
  const y = toText(b);
  switch (op) {
    case '=':
      return x === y;
    case '<>':
      return x !== y;
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    default:
      return false;
  }
}

class EvaluatorVisitor implements AstVisitor<CellValue | CellValue[]> {
  constructor(
    private readonly ctx: EvalContext,
    private readonly registry: FunctionRegistry,
    private readonly maxRow: number,
    private readonly maxCol: number,
  ) {}

  private readCell(row: number, col: number): CellValue {
    if (row < 0 || col < 0 || row > this.maxRow || col > this.maxCol) {
      return err('#REF!', `引用的单元格 ${col},${row} 超出网格`);
    }
    return this.ctx.getCell(row, col);
  }

  visitNumber(node: Extract<A1Node, { kind: 'number' }>): CellValue {
    return { type: 'number', value: node.value };
  }
  visitText(node: Extract<A1Node, { kind: 'text' }>): CellValue {
    return { type: 'text', value: node.value };
  }
  visitBoolean(node: Extract<A1Node, { kind: 'boolean' }>): CellValue {
    return { type: 'boolean', value: node.value };
  }
  visitRef(node: Extract<A1Node, { kind: 'ref' }>): CellValue {
    return this.readCell(node.row, node.col);
  }
  visitRange(node: Extract<A1Node, { kind: 'range' }>): CellValue[] {
    const rect = normalizeRect(
      { row: node.start.row, col: node.start.col },
      { row: node.end.row, col: node.end.col },
    );
    if (
      rect.top < 0 ||
      rect.left < 0 ||
      rect.bottom > this.maxRow ||
      rect.right > this.maxCol
    ) {
      throw new EvalFlow(err('#REF!', '区域引用超出网格'));
    }
    return expandRect(rect).map((a) => this.readCell(a.row, a.col));
  }
  visitNameError(node: Extract<A1Node, { kind: 'nameError' }>): CellValue {
    return err('#NAME?', `无法识别的名称: ${node.name}`);
  }

  visitUnary(node: Extract<A1Node, { kind: 'unary' }>, operand: CellValue | CellValue[]): CellValue {
    const v = Array.isArray(operand) ? (operand[0] ?? EMPTY) : operand;
    if (v.type === 'error') throw new EvalFlow(v);
    const n = toNumber(v);
    return { type: 'number', value: node.operator === '-' ? -n : n };
  }

  visitPercent(node: Extract<A1Node, { kind: 'percent' }>, operand: CellValue | CellValue[]): CellValue {
    void node;
    const v = Array.isArray(operand) ? (operand[0] ?? EMPTY) : operand;
    if (v.type === 'error') throw new EvalFlow(v);
    return { type: 'number', value: toNumber(v) / 100 };
  }

  visitBinary(
    node: Extract<A1Node, { kind: 'binary' }>,
    left: CellValue | CellValue[],
    right: CellValue | CellValue[],
  ): CellValue {
    const l = Array.isArray(left) ? (left[0] ?? EMPTY) : left;
    const r = Array.isArray(right) ? (right[0] ?? EMPTY) : right;
    if (l.type === 'error') throw new EvalFlow(l);
    if (r.type === 'error') throw new EvalFlow(r);

    const op = node.operator;
    if (op === '&') {
      return { type: 'text', value: toText(l) + toText(r) };
    }
    if (['=', '<>', '<', '<=', '>', '>='].includes(op)) {
      return { type: 'boolean', value: compare(op as BinaryOperator, l, r) };
    }
    const x = toNumber(l);
    const y = toNumber(r);
    switch (op) {
      case '+':
        return { type: 'number', value: x + y };
      case '-':
        return { type: 'number', value: x - y };
      case '*':
        return { type: 'number', value: x * y };
      case '/':
        if (y === 0) throw new EvalFlow(err('#DIV/0!', '除数为 0'));
        return { type: 'number', value: x / y };
      case '^':
        return { type: 'number', value: x ** y };
      default:
        return err('#VALUE!', `不支持的运算符: ${op}`);
    }
  }

  visitFunction(
    node: Extract<A1Node, { kind: 'function' }>,
    argResults: Array<CellValue | CellValue[]>,
  ): CellValue {
    const regError = this.registry.validate(node.name, node.args.length);
    if (regError) return regError;
    const fn = this.registry.get(node.name)!;

    // 错误传播（特性 26）：任一参数（含区域数组内单元格）为错误 => 传播
    for (const a of argResults) {
      const list = Array.isArray(a) ? a : [a];
      for (const v of list) {
        if (v.type === 'error') return v;
      }
    }
    return fn.impl(argResults as ArgValue[], this.ctx);
  }

  /** 惰性函数（IF）：仅求值条件命中的分支 */
  private evalLazyFunction(node: Extract<A1Node, { kind: 'function' }>): CellValue {
    const regError = this.registry.validate(node.name, node.args.length);
    if (regError) return regError;
    const fn = this.registry.get(node.name)!;

    const condVal = this.evalNode(node.args[0]!);
    const condScalar = Array.isArray(condVal) ? (condVal[0] ?? EMPTY) : condVal;
    if (condScalar.type === 'error') return condScalar;

    const truthy =
      condScalar.type === 'boolean'
        ? condScalar.value
        : condScalar.type === 'number' && condScalar.value !== 0;

    const branchIdx = truthy ? 1 : 2;
    const args: ArgValue[] = [condVal];
    for (let i = 1; i < node.args.length; i++) {
      args[i] = i === branchIdx ? this.evalNode(node.args[i]!) : EMPTY;
    }
    return fn.impl(args, this.ctx);
  }

  evalNode(node: A1Node): CellValue | CellValue[] {
    // 在 walkAst 之前拦截惰性函数，避免未命中分支被提前求值
    if (node.kind === 'function') {
      const fn = this.registry.get(node.name);
      if (fn?.signature.lazy) return this.evalLazyFunction(node);
    }
    return walkAst(node, this);
  }
}

export function evaluate(
  ast: A1Node,
  ctx: EvalContext,
  options: EvaluatorOptions,
): CellValue {
  const registry = options.registry ?? createBuiltinRegistry();
  const visitor = new EvaluatorVisitor(ctx, registry, options.maxRow, options.maxCol);
  try {
    const result = visitor.evalNode(ast);
    return Array.isArray(result) ? (result[0] ?? EMPTY) : result;
  } catch (e) {
    if (e instanceof EvalFlow) return e.value;
    throw e;
  }
}
