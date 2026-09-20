/**
 * 手写公式词法分析器（特性 8）。
 *
 * 输入公式正文（不含开头的 '='），输出 Token 流。
 * Token 携带行列/偏移位置，供语法错误定位（特性 11）。
 */

export type TokenType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'error'
  | 'reference'
  | 'name' // 函数名 / TRUE / FALSE 之外的裸标识符
  | 'cellRefWithRange' // 不会产生，范围由解析器组合两个 reference
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'percent'
  | 'caret'
  | 'ampersand'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'eof';

export interface Token {
  type: TokenType;
  /** 原始文本 */
  text: string;
  /** 在公式正文中的起始偏移（0 基） */
  offset: number;
  /** 长度 */
  length: number;
  /** 1 基行（公式为单行，始终为 1，保留以兼容错误定位接口） */
  line: number;
  /** 1 基列 */
  column: number;
  value?: number | string | boolean;
}

export interface LexError {
  message: string;
  offset: number;
  length: number;
  line: number;
  column: number;
}

const REFERENCE_START = /[A-Za-z$]/;
const ID_PART = /[A-Za-z0-9_.$]/;
const DIGIT = /[0-9]/;

const ERROR_LITERALS = new Set([
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#N/A',
]);

export class Lexer {
  private pos = 0;
  private readonly tokens: Token[] = [];

  constructor(private readonly src: string) {}

  static tokenize(src: string): { tokens: Token[]; error: LexError | null } {
    const lexer = new Lexer(src);
    return lexer.run();
  }

  run(): { tokens: Token[]; error: LexError | null } {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]!;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos++;
        continue;
      }
      const start = this.pos;

      // 数字字面量
      if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(this.src[this.pos + 1] ?? ''))) {
        this.readNumber(start);
        continue;
      }
      // 字符串字面量
      if (ch === '"') {
        const err = this.readString(start);
        if (err) return { tokens: this.tokens, error: err };
        continue;
      }
      // 错误字面量
      if (ch === '#') {
        const err = this.readErrorLiteral(start);
        if (err) return { tokens: this.tokens, error: err };
        continue;
      }
      // 引用 / 名称 / 布尔
      if (REFERENCE_START.test(ch)) {
        this.readWord(start);
        continue;
      }
      // 运算符与标点
      const err = this.readOperator(start);
      if (err) return { tokens: this.tokens, error: err };
    }

    this.tokens.push(this.makeToken('eof', '', this.pos, 0));
    return { tokens: this.tokens, error: null };
  }

  private makeToken(
    type: TokenType,
    text: string,
    start: number,
    length: number,
    value?: number | string | boolean,
  ): Token {
    const tok: Token = {
      type,
      text,
      offset: start,
      length,
      line: 1,
      column: start + 1,
    };
    if (value !== undefined) tok.value = value;
    return tok;
  }

  private lexError(message: string, start: number, length = 1): LexError {
    return { message, offset: start, length, line: 1, column: start + 1 };
  }

  private readNumber(start: number): void {
    let sawDot = false;
    let sawE = false;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (DIGIT.test(c)) {
        this.pos++;
      } else if (c === '.' && !sawDot && !sawE) {
        sawDot = true;
        this.pos++;
      } else if ((c === 'E' || c === 'e') && !sawE) {
        sawE = true;
        this.pos++;
        const n = this.src[this.pos];
        if (n === '+' || n === '-') this.pos++;
      } else {
        break;
      }
    }
    const text = this.src.slice(start, this.pos);
    const value = Number(text);
    this.tokens.push(this.makeToken('number', text, start, text.length, value));
  }

  private readString(start: number): LexError | null {
    this.pos++; // 跳过开引号
    let value = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"') {
        if (this.src[this.pos + 1] === '"') {
          value += '"';
          this.pos += 2;
        } else {
          this.pos++;
          const text = this.src.slice(start, this.pos);
          this.tokens.push(this.makeToken('string', text, start, text.length, value));
          return null;
        }
      } else {
        value += c;
        this.pos++;
      }
    }
    return this.lexError('字符串缺少结束引号 "', start, this.pos - start);
  }

  private readErrorLiteral(start: number): LexError | null {
    // 错误字面量字符集：#DIV/0! #VALUE! #REF! #NAME? #N/A
    let end = start + 1;
    while (end < this.src.length) {
      const c = this.src[end]!;
      if (/[A-Z0-9/?!]/.test(c)) {
        end++;
        if (c === '!' || c === '?') break;
      } else {
        break;
      }
    }
    const text = this.src.slice(start, end);
    if (!ERROR_LITERALS.has(text)) {
      return this.lexError(`无法识别的错误字面量 ${text}`, start, Math.max(1, text.length));
    }
    this.pos = end;
    this.tokens.push(this.makeToken('error', text, start, text.length, text));
    return null;
  }

  private readWord(start: number): void {
    while (this.pos < this.src.length && ID_PART.test(this.src[this.pos]!)) {
      this.pos++;
    }
    const text = this.src.slice(start, this.pos);
    const upper = text.toUpperCase();

    if (upper === 'TRUE' || upper === 'FALSE') {
      this.tokens.push(
        this.makeToken('boolean', text, start, text.length, upper === 'TRUE'),
      );
      return;
    }

    // 判断是否为单元格引用：$?字母+$?数字
    const isRef = /^(\$?)([A-Za-z]{1,2})(\$?)([0-9]+)$/.test(text);
    if (isRef) {
      this.tokens.push(this.makeToken('reference', text, start, text.length));
      return;
    }

    // 裸 $ 或仅 "$" 非法
    if (!/[A-Za-z]/.test(text)) {
      // makeToken 仍生成 name，由解析器报错；这里保持简单
    }
    this.tokens.push(this.makeToken('name', text, start, text.length, upper));
  }

  private readOperator(start: number): LexError | null {
    const c = this.src[this.pos]!;
    const next = this.src[this.pos + 1] ?? '';
    const emit = (type: TokenType, len: number): void => {
      const text = this.src.slice(start, start + len);
      this.tokens.push(this.makeToken(type, text, start, len));
      this.pos += len;
    };

    switch (c) {
      case '(':
        emit('lparen', 1);
        return null;
      case ')':
        emit('rparen', 1);
        return null;
      case ',':
        emit('comma', 1);
        return null;
      case ':':
        emit('colon', 1);
        return null;
      case '+':
        emit('plus', 1);
        return null;
      case '-':
        emit('minus', 1);
        return null;
      case '*':
        emit('star', 1);
        return null;
      case '/':
        emit('slash', 1);
        return null;
      case '%':
        emit('percent', 1);
        return null;
      case '^':
        emit('caret', 1);
        return null;
      case '&':
        emit('ampersand', 1);
        return null;
      case '=':
        emit('eq', 1);
        return null;
      case '<':
        if (next === '=') emit('lte', 2);
        else if (next === '>') emit('neq', 2);
        else emit('lt', 1);
        return null;
      case '>':
        if (next === '=') emit('gte', 2);
        else emit('gt', 1);
        return null;
      default:
        return this.lexError(`无法识别的字符 "${c}"`, start);
    }
  }
}
