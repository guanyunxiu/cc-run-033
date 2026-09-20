/**
 * 手写递归下降 Parser（特性 9、技术点 7）。
 *
 * 文法（优先级从低到高）：
 *   expression    -> comparison
 *   comparison    -> concat ((= | <> | < | <= | > | >=) concat)*
 *   concat        -> additive ('&' additive)*
 *   additive      -> multiplicative (('+' | '-') multiplicative)*
 *   multiplicative -> exponent (('*' | '/') exponent)*
 *   exponent      -> postfix ('^' postfix)*        （右结合）
 *   postfix       -> unary ('%')*
 *   unary         -> ('+' | '-') unary | primary
 *   primary       -> number | string | boolean | error
 *                  | reference (':' reference)?
 *                  | name '(' args? ')'
 *                  | '(' expression ')'
 *
 * 语法错误抛出 ParseError，携带 offset/length，用于特性 11 的错误定位。
 */
import {
  AstNode,
  BinaryOperator,
  BinaryNode,
  FunctionNode,
  NodePosition,
  RangeNode,
  ReferenceNode,
  UnaryNode,
} from './ast';
import { parseReference } from './a1';
import type { ErrorCode } from './errors';
import { Lexer, Token, TokenType } from './lexer';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly length: number,
    readonly column: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface ParseResult {
  ast: AstNode | null;
  error: ParseError | null;
  tokens: Token[];
}

const BINARY_TOKEN_OP: Partial<Record<TokenType, BinaryOperator>> = {
  plus: '+',
  minus: '-',
  star: '*',
  slash: '/',
  caret: '^',
  ampersand: '&',
  eq: '=',
  neq: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

export class Parser {
  private index = 0;

  private constructor(private readonly tokens: Token[]) {}

  static parseFormula(formulaBody: string): ParseResult {
    const { tokens, error: lexError } = Lexer.tokenize(formulaBody);
    if (lexError) {
      return {
        ast: null,
        tokens,
        error: new ParseError(
          lexError.message,
          lexError.offset,
          lexError.length,
          lexError.column,
        ),
      };
    }
    const parser = new Parser(tokens);
    try {
      const ast = parser.parseExpression();
      const eof = parser.peek();
      if (eof.type !== 'eof') {
        throw parser.expected('公式结束', eof);
      }
      return { ast, error: null, tokens };
    } catch (e) {
      if (e instanceof ParseError) return { ast: null, error: e, tokens };
      throw e;
    }
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    const t = this.tokens[this.index]!;
    this.index++;
    return t;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(type: TokenType): Token | null {
    if (this.check(type)) return this.next();
    return null;
  }

  private expected(what: string, token?: Token): ParseError {
    const t = token ?? this.peek();
    return new ParseError(
      `期望 ${what}，但遇到 ${describeToken(t)}`,
      t.offset,
      Math.max(t.length, 1),
      t.column,
    );
  }

  parseExpression(): AstNode {
    return this.parseComparison();
  }

  private parseComparison(): AstNode {
    let left = this.parseConcat();
    for (;;) {
      const t = this.peek();
      const op = BINARY_TOKEN_OP[t.type];
      if (
        op === undefined ||
        !['=', '<>', '<', '<=', '>', '>='].includes(op)
      ) {
        break;
      }
      this.next();
      const right = this.parseConcat();
      left = this.binary(op, left, right, t);
    }
    return left;
  }

  private parseConcat(): AstNode {
    let left = this.parseAdditive();
    while (this.check('ampersand')) {
      const t = this.next();
      const right = this.parseAdditive();
      left = this.binary('&', left, right, t);
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      let op: BinaryOperator | null = null;
      if (t.type === 'plus') op = '+';
      else if (t.type === 'minus') op = '-';
      if (!op) break;
      this.next();
      const right = this.parseMultiplicative();
      left = this.binary(op, left, right, t);
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseExponent();
    for (;;) {
      const t = this.peek();
      let op: BinaryOperator | null = null;
      if (t.type === 'star') op = '*';
      else if (t.type === 'slash') op = '/';
      if (!op) break;
      this.next();
      const right = this.parseExponent();
      left = this.binary(op, left, right, t);
    }
    return left;
  }

  private parseExponent(): AstNode {
    // ^ 右结合
    const base = this.parseUnary();
    if (this.check('caret')) {
      const t = this.next();
      const exponent = this.parseExponent();
      return this.binary('^', base, exponent, t);
    }
    return base;
  }

  private parseUnary(): AstNode {
    const t = this.peek();
    if (t.type === 'minus' || t.type === 'plus') {
      this.next();
      const operand = this.parseUnary();
      return {
        type: 'unary',
        operator: t.type === 'minus' ? '-' : '+',
        operand,
        postfix: false,
        pos: this.span(t, operand.pos),
      } as UnaryNode;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    // 百分号后缀，可重复并可作用于括号表达式：50%、-A1%、(1+2)%
    let node = this.parsePrimary();
    while (this.check('percent')) {
      const t = this.next();
      node = {
        type: 'unary',
        operator: '%',
        operand: node,
        postfix: true,
        pos: this.span(node.pos, t),
      } as UnaryNode;
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.peek();

    switch (t.type) {
      case 'number': {
        this.next();
        return { type: 'number', value: t.value as number, pos: this.posOf(t) };
      }
      case 'string': {
        this.next();
        return { type: 'string', value: t.value as string, pos: this.posOf(t) };
      }
      case 'boolean': {
        this.next();
        return { type: 'boolean', value: t.value as boolean, pos: this.posOf(t) };
      }
      case 'error': {
        this.next();
        return { type: 'error', code: t.value as ErrorCode, pos: this.posOf(t) };
      }
      case 'reference': {
        return this.parseReferenceOrRange();
      }
      case 'name': {
        return this.parseFunctionCall();
      }
      case 'lparen': {
        this.next();
        const inner = this.parseExpression();
        if (!this.match('rparen')) throw this.expected('右括号 ")"');
        // 括号节点不单独建模：位置仍以内在节点为准（足够调试用）
        return inner;
      }
      default:
        throw this.expected('数值、引用、函数或左括号');
    }
  }

  private parseReferenceOrRange(): AstNode {
    const first = this.next();
    const ref = parseReference(first.text);
    if (!ref) throw this.expected('合法的单元格引用', first);
    const firstNode: ReferenceNode = {
      type: 'reference',
      ref,
      text: first.text.toUpperCase(),
      pos: this.posOf(first),
    };

    if (this.check('colon')) {
      this.next();
      const secondTok = this.peek();
      if (secondTok.type !== 'reference') {
        throw this.expected('区域终点引用（如 B10）');
      }
      this.next();
      const end = parseReference(secondTok.text);
      if (!end) throw this.expected('合法的单元格引用', secondTok);
      const rangeNode: RangeNode = {
        type: 'range',
        range: {
          start: {
            col: Math.min(ref.col, end.col),
            row: Math.min(ref.row, end.row),
            colAbsolute: ref.colAbsolute,
            rowAbsolute: ref.rowAbsolute,
          },
          end: {
            col: Math.max(ref.col, end.col),
            row: Math.max(ref.row, end.row),
            colAbsolute: end.colAbsolute,
            rowAbsolute: end.rowAbsolute,
          },
        },
        text: `${first.text.toUpperCase()}:${secondTok.text.toUpperCase()}`,
        pos: {
          offset: first.offset,
          length: secondTok.offset + secondTok.length - first.offset,
        },
      };
      return rangeNode;
    }
    return firstNode;
  }

  private parseFunctionCall(): AstNode {
    const nameTok = this.next();
    const fnName = (nameTok.value as string) ?? nameTok.text.toUpperCase();
    if (!this.match('lparen')) {
      // 裸标识符不是合法表达式（#NAME? 由求值阶段处理，此处直接语法报错）
      throw new ParseError(
        `未知名称 "${nameTok.text}"（函数名后需要括号）`,
        nameTok.offset,
        nameTok.length,
        nameTok.column,
      );
    }
    const args: AstNode[] = [];
    if (!this.check('rparen')) {
      args.push(this.parseExpression());
      while (this.match('comma')) {
        if (this.check('rparen')) throw this.expected('函数参数');
        args.push(this.parseExpression());
      }
    }
    const close = this.match('rparen');
    if (!close) throw this.expected('右括号 ")"');
    const node: FunctionNode = {
      type: 'function',
      name: fnName,
      args,
      pos: {
        offset: nameTok.offset,
        length: close.offset + close.length - nameTok.offset,
      },
    };
    return node;
  }

  private binary(
    op: BinaryOperator,
    left: AstNode,
    right: AstNode,
    opToken: Token,
  ): BinaryNode {
    void opToken;
    return {
      type: 'binary',
      operator: op,
      left,
      right,
      pos: {
        offset: left.pos.offset,
        length: right.pos.offset + right.pos.length - left.pos.offset,
      },
    };
  }

  private posOf(t: Token): NodePosition {
    return { offset: t.offset, length: Math.max(t.length, 1) };
  }

  private span(start: NodePosition | Token, end: NodePosition | Token): NodePosition {
    const s = 'offset' in start && 'length' in start && !('type' in start)
      ? (start as NodePosition)
      : { offset: (start as Token).offset, length: (start as Token).length };
    const e =
      'type' in end
        ? { offset: (end as Token).offset, length: (end as Token).length }
        : (end as NodePosition);
    return {
      offset: s.offset,
      length: e.offset + e.length - s.offset,
    };
  }
}

function describeToken(t: Token): string {
  switch (t.type) {
    case 'eof':
      return '公式结束';
    case 'number':
      return `数字 ${t.text}`;
    case 'string':
      return `字符串 "${t.text}"`;
    case 'reference':
      return `引用 ${t.text}`;
    case 'name':
      return `名称 ${t.text}`;
    default:
      return `"${t.text}"`;
  }
}
