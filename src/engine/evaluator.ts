/**
 * 公式求值器（特性 13/15/25/26，技术点 9 访问者模式）。
 *
 * - 引用解析：A1 / $A$1 等一律按坐标从单元格表取值；
 * - 区域展开：RangeNode 求值为二维数组，交给函数处理；
 * - 错误传播：任何操作数/参数携带错误时按语义抛出或透传；
 * - 求值假设依赖单元格已按拓扑顺序完成求值（由 Workbook 保证）。
 */
import { AstNode, AstVisitor, BinaryNode, FunctionNode } from './ast';
import { EvalError } from './errors';
import {
  ArrayValue,
  FunctionArg,
  FunctionRegistry,
  isArrayArg,
} from './functions';
import {
  bool,
  errVal,
  isError,
  num,
  ScalarValue,
  txt,
} from './value';

export interface EvalContext {
  /** 取单元格当前值（空单元格返回 EMPTY） */
  getCell(col: number, row: number): ScalarValue;
  registry: FunctionRegistry;
  /** 求值时遇到自引用/未求值节点由外部决定（这里直接读当前值） */
}

/* ---------- 类型转换（与 Excel 近似的简化规则） ---------- */

function toNumber(v: ScalarValue): number {
  switch (v.kind) {
    case 'number':
      return v.value;
    case 'boolean':
      return v.value ? 1 : 0;
    case 'empty':
      return 0;
    case 'error':
      throw new EvalError(v.code);
    case 'text': {
      const trimmed = v.value.trim();
      if (trimmed === '') return 0;
      const n = Number(trimmed);
      if (Number.isNaN(n)) throw new EvalError('#VALUE!', `文本 "${v.value}" 无法转为数字`);
      return n;
    }
  }
}

function toText(v: ScalarValue): string {
  switch (v.kind) {
    case 'text':
      return v.value;
    case 'number':
      return String(v.value);
    case 'boolean':
      return v.value ? 'TRUE' : 'FALSE';
    case 'empty':
      return '';
    case 'error':
      throw new EvalError(v.code);
  }
}

/** 比较用键：错误 -> 抛错；数字与布尔按数值；文本按文本；空按空串。 */
function compareValues(a: ScalarValue, b: ScalarValue): number {
  if (isError(a)) throw new EvalError(a.code);
  if (isError(b)) throw new EvalError(b.code);

  // 同类数值比较
  if (
    (a.kind === 'number' || a.kind === 'boolean') &&
    (b.kind === 'number' || b.kind === 'boolean')
  ) {
    const av = a.kind === 'number' ? a.value : a.value ? 1 : 0;
    const bv = b.kind === 'number' ? b.value : b.value ? 1 : 0;
    return Math.sign(av - bv);
  }
  // 空 -> 数字 0 / 空文本
  const at =
    a.kind === 'empty' ? '' : a.kind === 'number' ? String(a.value) : a.kind === 'text' ? a.value : a.value ? 'TRUE' : 'FALSE';
  const bt =
    b.kind === 'empty' ? '' : b.kind === 'number' ? String(b.value) : b.kind === 'text' ? b.value : b.value ? 'TRUE' : 'FALSE';
  return at < bt ? -1 : at > bt ? 1 : 0;
}

class EvalVisitor implements AstVisitor<ScalarValue> {
  constructor(private readonly ctx: EvalContext) {}

  visitNumber(node: ExtractNode<'number'>): ScalarValue {
    return num(node.value);
  }
  visitString(node: ExtractNode<'string'>): ScalarValue {
    return txt(node.value);
  }
  visitBoolean(node: ExtractNode<'boolean'>): ScalarValue {
    return bool(node.value);
  }
  visitError(node: ExtractNode<'error'>): ScalarValue {
    return errVal(node.code);
  }
  visitReference(node: ExtractNode<'reference'>): ScalarValue {
    return this.ctx.getCell(node.ref.col, node.ref.row);
  }
  visitRange(node: ExtractNode<'range'>): ScalarValue {
    // 独立出现的区域表达式：用左上角值（数组会在函数参数路径中保留）
    const { start } = node.range;
    return this.ctx.getCell(start.col, start.row);
  }

  visitUnary(node: ExtractNode<'unary'>): ScalarValue {
    const v = evalNode(node.operand, this.ctx);
    if (isError(v)) return v;
    if (node.operator === '%') {
      return num(toNumber(v) / 100);
    }
    const n = toNumber(v);
    return num(node.operator === '-' ? -n : +n);
  }

  visitBinary(node: BinaryNode): ScalarValue {
    // 比较
    if (['=', '<>', '<', '<=', '>', '>='].includes(node.operator)) {
      const l = evalNode(node.left, this.ctx);
      const r = evalNode(node.right, this.ctx);
      try {
        const c = compareValues(l, r);
        const result =
          node.operator === '='
            ? c === 0
            : node.operator === '<>'
              ? c !== 0
              : node.operator === '<'
                ? c < 0
                : node.operator === '<='
                  ? c <= 0
                  : node.operator === '>'
                    ? c > 0
                    : c >= 0;
        return bool(result);
      } catch (e) {
        if (e instanceof EvalError) return errVal(e.code);
        throw e;
      }
    }

    // 文本连接
    if (node.operator === '&') {
      const l = evalNode(node.left, this.ctx);
      const r = evalNode(node.right, this.ctx);
      try {
        return txt(toText(l) + toText(r));
      } catch (e) {
        if (e instanceof EvalError) return errVal(e.code);
        throw e;
      }
    }

    // 算术
    const l = evalNode(node.left, this.ctx);
    const r = evalNode(node.right, this.ctx);
    if (isError(l)) return l;
    if (isError(r)) return r;
    try {
      const a = toNumber(l);
      const b = toNumber(r);
      switch (node.operator) {
        case '+':
          return num(a + b);
        case '-':
          return num(a - b);
        case '*':
          return num(a * b);
        case '/':
          if (b === 0) return errVal('#DIV/0!');
          return num(a / b);
        case '^':
          return num(a ** b);
        default:
          return errVal('#VALUE!');
      }
    } catch (e) {
      if (e instanceof EvalError) return errVal(e.code);
      throw e;
    }
  }

  visitFunction(node: FunctionNode): ScalarValue {
    const { registry } = this.ctx;
    const validation = registry.validate(node.name, node.args.length);
    if (validation) return errVal(validation.code);

    // IF 惰性求值：只计算被选中的分支
    if (node.name === 'IF') {
      return this.evalIf(node);
    }

    const def = registry.get(node.name)!;
    const args: FunctionArg[] = node.args.map((a) => this.evalArg(a));
    try {
      return def.impl(args, { argCount: args.length });
    } catch (e) {
      if (e instanceof EvalError) return errVal(e.code);
      throw e;
    }
  }

  private evalArg(node: AstNode): FunctionArg {
    if (node.type === 'range') {
      const result: ArrayValue = [];
      for (let row = node.range.start.row; row <= node.range.end.row; row++) {
        const rowValues: ScalarValue[] = [];
        for (let col = node.range.start.col; col <= node.range.end.col; col++) {
          rowValues.push(this.ctx.getCell(col, row));
        }
        result.push(rowValues);
      }
      return result;
    }
    return evalNode(node, this.ctx);
  }

  private evalIf(node: FunctionNode): ScalarValue {
    const condition = evalNode(node.args[0]!, this.ctx);
    if (isError(condition)) return condition;
    let test: boolean;
    try {
      test = toLogicalForIf(condition);
    } catch (e) {
      if (e instanceof EvalError) return errVal(e.code);
      throw e;
    }
    if (test) {
      return node.args[1] ? evalNode(node.args[1], this.ctx) : bool(true);
    }
    return node.args[2] ? evalNode(node.args[2], this.ctx) : bool(false);
  }
}

function toLogicalForIf(v: ScalarValue): boolean {
  if (v.kind === 'boolean') return v.value;
  if (v.kind === 'number') return v.value !== 0;
  if (v.kind === 'empty') return false;
  if (v.kind === 'text') {
    const t = v.value.trim().toUpperCase();
    if (t === 'TRUE') return true;
    if (t === 'FALSE' || t === '') return false;
    throw new EvalError('#VALUE!');
  }
  throw new EvalError(v.code);
}

type ExtractNode<K extends AstNode['type']> = Extract<AstNode, { type: K }>;

import { visitAst } from './ast';

export function evalNode(node: AstNode, ctx: EvalContext): ScalarValue {
  return visitAst(node, new EvalVisitor(ctx));
}

/** 便捷入口：在给定单元格值表上求值。 */
export function evaluateAst(
  node: AstNode,
  getCell: (col: number, row: number) => ScalarValue,
  registry: FunctionRegistry,
): ScalarValue {
  return evalNode(node, { getCell, registry });
}

/** 工具：把参数展平为标量序列时，供外部（测试）使用。 */
export function flattenArg(arg: FunctionArg): ScalarValue[] {
  if (!isArrayArg(arg)) return [arg];
  const out: ScalarValue[] = [];
  for (const row of arg) out.push(...row);
  return out;
}
