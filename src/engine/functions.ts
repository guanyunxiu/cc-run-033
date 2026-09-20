/**
 * 函数注册表（特性 15，技术点 13、14：函数签名与参数校验）。
 *
 * 函数参数在求值阶段被规整为 FunctionArg（标量或二维数组），
 * 每个函数自行决定如何处理错误传播、空单元格与类型转换。
 * IF 采用惰性求值，在 evaluator 中特殊处理。
 */
import { EvalError } from './errors';
import {
  bool,
  EMPTY,
  errVal,
  isError,
  num,
  ScalarValue,
  txt,
} from './value';

/** 区域参数：二维标量数组（行为外层） */
export type ArrayValue = ScalarValue[][];
export type FunctionArg = ScalarValue | ArrayValue;

export interface FunctionContext {
  /** 参数个数（错误诊断用） */
  argCount: number;
}

export type FunctionImpl = (
  args: FunctionArg[],
  ctx: FunctionContext,
) => ScalarValue;

export interface FunctionSignature {
  name: string;
  minArgs: number;
  maxArgs: number;
  description: string;
}

export interface FunctionDefinition extends FunctionSignature {
  impl: FunctionImpl;
}

export class FunctionRegistry {
  private readonly map = new Map<string, FunctionDefinition>();

  register(def: FunctionDefinition): void {
    this.map.set(def.name, def);
  }

  get(name: string): FunctionDefinition | undefined {
    return this.map.get(name);
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  names(): string[] {
    return [...this.map.keys()].sort();
  }

  /** 签名与参数个数校验，返回错误值或 null。 */
  validate(name: string, argCount: number): EvalError | null {
    const def = this.map.get(name);
    if (!def) return new EvalError('#NAME?', `未知函数: ${name}`);
    if (argCount < def.minArgs || argCount > def.maxArgs) {
      return new EvalError(
        '#N/A',
        `函数 ${name} 参数个数错误：期望 ${def.minArgs}${
          def.maxArgs === def.minArgs ? '' : `~${def.maxArgs}`
        } 个，实际 ${argCount} 个`,
      );
    }
    return null;
  }
}

/* ---------------- 参数遍历工具 ---------------- */

export function isArrayArg(a: FunctionArg): a is ArrayValue {
  return Array.isArray(a);
}

/** 遍历参数中的全部标量（区域逐行展开）。 */
export function* eachScalar(args: FunctionArg[]): Generator<ScalarValue> {
  for (const arg of args) {
    if (isArrayArg(arg)) {
      for (const row of arg) {
        for (const cell of row) yield cell;
      }
    } else {
      yield arg;
    }
  }
}

/**
 * 遍历区域内的数字（忽略空单元格与文本，符合 SUM 语义）；
 * 直接传入的布尔/数字标量参与计算，区域内布尔忽略。
 * 遇到错误立即抛出（错误传播，特性 26）。
 */
function* numericCells(args: FunctionArg[]): Generator<number> {
  for (const arg of args) {
    if (isArrayArg(arg)) {
      for (const row of arg) {
        for (const cell of row) {
          if (cell.kind === 'error') throw new EvalError(cell.code);
          if (cell.kind === 'number') yield cell.value;
          // 空/文本/布尔：忽略
        }
      }
    } else if (arg.kind === 'number') {
      yield arg.value;
    } else if (arg.kind === 'error') {
      throw new EvalError(arg.code);
    }
  }
}

function toLogical(v: ScalarValue): boolean {
  if (v.kind === 'boolean') return v.value;
  if (v.kind === 'number') return v.value !== 0;
  if (v.kind === 'error') throw new EvalError(v.code);
  // 文本/空：Excel 中 AND(A1) 不做文本转布尔，按 VALUE 错误处理
  throw new EvalError('#VALUE!', '逻辑函数需要布尔或数字参数');
}

/* ---------------- 内置函数实现 ---------------- */

const sumImpl: FunctionImpl = (args) => {
  let total = 0;
  for (const n of numericCells(args)) total += n;
  return num(total);
};

const averageImpl: FunctionImpl = (args) => {
  let total = 0;
  let count = 0;
  for (const n of numericCells(args)) {
    total += n;
    count++;
  }
  if (count === 0) return errVal('#DIV/0!');
  return num(total / count);
};

function minMax(choose: 'min' | 'max'): FunctionImpl {
  return (args) => {
    let acc = choose === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    let found = false;
    for (const n of numericCells(args)) {
      found = true;
      acc = choose === 'min' ? Math.min(acc, n) : Math.max(acc, n);
    }
    if (!found) return num(0); // 空区域上 MIN/MAX 返回 0
    return num(acc);
  };
}

const roundImpl: FunctionImpl = (args) => {
  // ROUND(number, digits) —— 仅接受标量数字；省略 digits 按 0 处理
  const value = scalar(args[0]!);
  if (value.kind === 'error') return value;
  if (value.kind !== 'number') return errVal('#VALUE!');

  let digits = 0;
  if (args[1] !== undefined) {
    const digitsValue = scalar(args[1]);
    if (digitsValue.kind === 'error') return digitsValue;
    if (digitsValue.kind !== 'number') return errVal('#VALUE!');
    digits = digitsValue.value;
  }

  const factor = 10 ** digits;
  // Excel ROUND 为四舍五入（远离零方向）
  const rounded =
    (Math.sign(value.value) * Math.round(Math.abs(value.value) * factor)) / factor;
  return num(rounded);
};

const absImpl: FunctionImpl = (args) => {
  const v = scalar(args[0]!);
  if (v.kind === 'error') return v;
  if (v.kind !== 'number') return errVal('#VALUE!');
  return num(Math.abs(v.value));
};

/** IF 的惰性实现在 evaluator 中直接处理，这里仅提供签名描述。 */
const ifSignatureOnly: FunctionImpl = () => {
  throw new EvalError('#N/A', 'IF 必须经过惰性求值路径');
};

function logicalAggregator(mode: 'and' | 'or'): FunctionImpl {
  return (args) => {
    if (args.length === 0) return bool(mode === 'and');
    let sawValue = false;
    for (const v of eachScalar(args)) {
      // 空单元格在 AND/OR 中忽略
      if (v.kind === 'empty') continue;
      sawValue = true;
      const b = toLogical(v);
      if (mode === 'and' && !b) return bool(false);
      if (mode === 'or' && b) return bool(true);
    }
    if (!sawValue) return errVal('#VALUE!');
    return bool(mode === 'and');
  };
}

const notImpl: FunctionImpl = (args) => {
  const v = scalar(args[0]!);
  if (v.kind === 'error') return v;
  if (v.kind === 'empty') return bool(true); // NOT(空) —— 空被视作 0
  try {
    return bool(!toLogical(v));
  } catch (e) {
    if (e instanceof EvalError) return errVal(e.code);
    throw e;
  }
};

const countImpl: FunctionImpl = (args) => {
  let n = 0;
  for (const arg of args) {
    if (isArrayArg(arg)) {
      for (const row of arg) {
        for (const cell of row) {
          if (cell.kind === 'number') n++;
          else if (cell.kind === 'error') throw new EvalError(cell.code);
        }
      }
    } else if (arg.kind === 'number') {
      n++;
    } else if (arg.kind === 'error') {
      throw new EvalError(arg.code);
    }
    // 直接传入的布尔在 COUNT 中不计数（与 COUNT 忽略区域内布尔一致）
  }
  return num(n);
};

const countaImpl: FunctionImpl = (args) => {
  let n = 0;
  for (const v of eachScalar(args)) {
    if (v.kind !== 'empty') n++;
  }
  return num(n);
};

function scalar(a: FunctionArg): ScalarValue {
  if (isArrayArg(a)) {
    for (const row of a) {
      for (const cell of row) {
        if (cell.kind !== 'empty') return cell;
      }
    }
    return EMPTY;
  }
  return a;
}

/** 创建内置函数注册表。 */
export function createBuiltinRegistry(): FunctionRegistry {
  const registry = new FunctionRegistry();
  const defs: FunctionDefinition[] = [
    { name: 'SUM', minArgs: 1, maxArgs: 255, description: '对区域内数字求和（忽略文本/空单元格）', impl: sumImpl },
    { name: 'AVERAGE', minArgs: 1, maxArgs: 255, description: '区域内数字的平均值；无数字时 #DIV/0!', impl: averageImpl },
    { name: 'MIN', minArgs: 1, maxArgs: 255, description: '最小值', impl: minMax('min') },
    { name: 'MAX', minArgs: 1, maxArgs: 255, description: '最大值', impl: minMax('max') },
    { name: 'ROUND', minArgs: 1, maxArgs: 2, description: '四舍五入到指定小数位', impl: roundImpl },
    { name: 'ABS', minArgs: 1, maxArgs: 1, description: '绝对值', impl: absImpl },
    { name: 'IF', minArgs: 1, maxArgs: 3, description: '条件判断（惰性求值）', impl: ifSignatureOnly },
    { name: 'AND', minArgs: 1, maxArgs: 255, description: '逻辑与', impl: logicalAggregator('and') },
    { name: 'OR', minArgs: 1, maxArgs: 255, description: '逻辑或', impl: logicalAggregator('or') },
    { name: 'NOT', minArgs: 1, maxArgs: 1, description: '逻辑非', impl: notImpl },
    { name: 'COUNT', minArgs: 1, maxArgs: 255, description: '统计数字单元格数量', impl: countImpl },
    { name: 'COUNTA', minArgs: 1, maxArgs: 255, description: '统计非空单元格数量', impl: countaImpl },
  ];
  for (const d of defs) registry.register(d);
  return registry;
}

export { txt };
