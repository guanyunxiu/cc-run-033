/**
 * 公式语法分析器（特性 9、10、11）。
 *
 * 手写递归下降，二元表达式使用 Pratt 优先级爬升。
 *
 * 文法：
 *   expression := comparison
 *   comparison := concat (('=' | '<>' | '<' | '<=' | '>' | '>=') concat)*
 *   concat     := additive ('&' additive)*
 *   additive   := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := exponent (('*' | '/') exponent)*
 *   exponent   := unary ('^' unary)*          （右结合）
 *   unary      := ('-' | '+') unary | postfix
 *   postfix    := primary ('%')*
 *   primary    := number | string | bool | ref (':' ref)? | ident '(' args ')'
 *               | ident(裸 -> nameError) | '(' expression ')'
 *
 * 语法错误抛出 FormulaError（#VALUE!）并携带 offset/length，UI 可据此定位（特性 11）。
 */
import {
  FormulaError,
  type A1Node,
  type BinaryOperator,
  type Position,
  type RefNode,
  type Token,
} from './types.js';
import { tokenize } from './lexer.js';
import { parseRef } from './address.js';

interface BindingPower {
  left: number;
  right: number;
}

const BINARY_PRECEDENCE: Record<string, BindingPower> = {
  '=': { left: 1, right: 1 },
  '<>': { left: 1, right: 1 },
  '<': { left: 1, right: 1 },
  '<=': { left: 1, right: 1 },
  '>': { left: 1, right: 1 },
  '>=': { left: 1, right: 1 },
  '&': { left: 2, right: 2 },
  '+': { left: 3, right: 3 },
  '-': { left: 3, right: 3 },
  '*': { left: 4, right: 4 },
  '/': { left: 4, right: 4 },
  '^': { left: 5, right: 5 }, // 右结合（见 parseExpression 的 +1）
};

export class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  static parse(formula: string): A1Node {
    const trimmed = formula.startsWith('=') ? formula.slice(1) : formula;
    const tokens = tokenize(trimmed);
    const parser = new Parser(tokens);
    const node = parser.parseExpression(0);
    const eof = parser.peek();
    if (eof.type !== 'eof') {
      throw new FormulaError(
        '#VALUE!',
        `多余的字符: "${eof.value}"`,
        eof.start,
        Math.max(1, eof.end - eof.start),
      );
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  private expect(type: Token['type'], what: string): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new FormulaError(
        '#VALUE!',
        `期望 ${what}，但遇到 "${t.type === 'eof' ? '公式结尾' : t.value}"`,
        t.start,
        Math.max(1, t.end - t.start),
      );
    }
    return this.next();
  }

  /** Pratt 优先级爬升 */
  parseExpression(minBindingPower: number): A1Node {
    let left = this.parseUnary();

    for (;;) {
      const t = this.peek();
      if (t.type !== 'op') break;
      const bp = BINARY_PRECEDENCE[t.value];
      if (!bp || bp.left < minBindingPower) break;
      this.next();
      // 右结合（^）：右操作数使用 左结合力-1，使同级 ^ 可以继续结合
      const isRightAssoc = t.value === '^';
      const right = this.parseExpression(isRightAssoc ? bp.right : bp.right + 1);
      left = {
        kind: 'binary',
        operator: t.value as BinaryOperator,
        left,
        right,
        pos: { start: left.pos.start, end: right.pos.end },
      };
    }
    return left;
  }

  private parseUnary(): A1Node {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      const operand = this.parseUnary();
      return {
        kind: 'unary',
        operator: t.value as '-' | '+',
        operand,
        pos: { start: t.start, end: operand.pos.end },
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): A1Node {
    let node = this.parsePrimary();
    while (this.peek().type === 'percent') {
      const pct = this.next();
      node = {
        kind: 'percent',
        operand: node,
        pos: { start: node.pos.start, end: pct.end },
      };
    }
    return node;
  }

  private makeRef(t: Token): RefNode {
    const p = parseRef(t.value, t.start);
    return {
      kind: 'ref',
      col: p.col,
      row: p.row,
      absoluteCol: p.absoluteCol,
      absoluteRow: p.absoluteRow,
      pos: { start: t.start, end: t.end },
    };
  }

  private parsePrimary(): A1Node {
    const t = this.peek();

    switch (t.type) {
      case 'number': {
        this.next();
        const value = Number(t.value);
        if (Number.isNaN(value)) {
          throw new FormulaError('#VALUE!', `无效的数字: ${t.value}`, t.start, t.end - t.start);
        }
        return { kind: 'number', value, pos: this.posOf(t) };
      }
      case 'string': {
        this.next();
        const raw = t.value.slice(1, -1).replace(/""/g, '"');
        return { kind: 'text', value: raw, pos: this.posOf(t) };
      }
      case 'bool': {
        this.next();
        return { kind: 'boolean', value: t.value.toUpperCase() === 'TRUE', pos: this.posOf(t) };
      }
      case 'ref': {
        this.next();
        const first = this.makeRef(t);
        // 区域引用 ref : ref
        if (this.peek().type === 'colon') {
          this.next();
          const endTok = this.expect('ref', '区域结束引用');
          const second = this.makeRef(endTok);
          return {
            kind: 'range',
            start: first,
            end: second,
            pos: { start: t.start, end: endTok.end },
          };
        }
        return first;
      }
      case 'lparen': {
        this.next();
        const inner = this.parseExpression(0);
        this.expect('rparen', '")"');
        return inner;
      }
      case 'ident': {
        this.next();
        if (this.peek().type === 'lparen') {
          this.next();
          const args: A1Node[] = [];
          if (this.peek().type !== 'rparen') {
            args.push(this.parseExpression(0));
            while (this.peek().type === 'comma') {
              this.next();
              args.push(this.parseExpression(0));
            }
          }
          const close = this.expect('rparen', '")"');
          return {
            kind: 'function',
            name: t.value.toUpperCase(),
            args,
            pos: { start: t.start, end: close.end },
          };
        }
        // 裸标识符：求值阶段产生 #NAME?，保留 AST 节点用于展示（特性 25）
        return { kind: 'nameError', name: t.value, pos: this.posOf(t) };
      }
      case 'op': {
        if (t.value === '-' || t.value === '+') {
          // 交给 parseUnary（理论上不会进入）
          return this.parseUnary();
        }
        throw new FormulaError(
          '#VALUE!',
          `缺少操作数，意外的运算符 "${t.value}"`,
          t.start,
          t.end - t.start,
        );
      }
      case 'rparen':
        throw new FormulaError('#VALUE!', '多余的右括号 ")"', t.start, 1);
      case 'comma':
        throw new FormulaError('#VALUE!', '意外的逗号 ","', t.start, 1);
      case 'colon':
        throw new FormulaError('#VALUE!', '意外的冒号 ":"', t.start, 1);
      case 'eof':
        throw new FormulaError('#VALUE!', '公式不完整，意外的结尾', t.start, 1);
      case 'percent':
        throw new FormulaError('#VALUE!', '百分号 "%" 缺少操作数', t.start, 1);
    }
  }

  private posOf(t: Token): Position {
    return { start: t.start, end: t.end };
  }
}

/** 便捷入口 */
export function parseFormula(formula: string): A1Node {
  return Parser.parse(formula);
}
