/**
 * 公式词法分析器（特性 8，手写 Lexer）。
 *
 * 输入：去掉前导 '=' 的公式字符串。
 * 输出：Token 流。
 *
 * Token 规则：
 *  - number   数字（整数 / 小数），如 12、3.14
 *  - string   双引号字符串，"" 为转义引号
 *  - ref      A1 / $A$1 形式
 *  - ident    函数名 / 裸标识符（如 SUM、foo）
 *  - bool     TRUE / FALSE
 *  - op       + - * / ^ & = <> < <= > >=
 *  - lparen / rparen / comma / percent
 */
import { FormulaError, type Token } from './types.js';
import { looksLikeRef } from './address.js';

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isAlpha = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  const push = (type: Token['type'], start: number, end: number): void => {
    tokens.push({ type, value: input.slice(start, end), start, end });
  };

  while (i < n) {
    const c = input[i];

    // 空白
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }

    // 字符串
    if (c === '"') {
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (input[i] === '"') {
          if (input[i + 1] === '"') {
            i += 2; // 转义
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        throw new FormulaError('#VALUE!', '字符串缺少结束引号', start, n - start);
      }
      push('string', start, i);
      continue;
    }

    // 数字
    if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? ''))) {
      const start = i;
      let dots = 0;
      while (i < n && (isDigit(input[i]) || input[i] === '.')) {
        if (input[i] === '.') dots++;
        i++;
      }
      // 科学计数法：1e3
      if (i < n && (input[i] === 'e' || input[i] === 'E')) {
        const save = i;
        i++;
        if (input[i] === '+' || input[i] === '-') i++;
        if (!isDigit(input[i] ?? '')) {
          throw new FormulaError('#VALUE!', '无效的科学计数法', save, 1);
        }
        while (i < n && isDigit(input[i])) i++;
      }
      if (dots > 1) {
        throw new FormulaError('#VALUE!', '无效的数字', start, i - start);
      }
      push('number', start, i);
      continue;
    }

    // 标识符 / 引用：字母或 $ 开头
    if (isAlpha(c) || c === '$') {
      const start = i;

      // 尝试按引用语法扫描：[$]字母序列[$]数字序列
      let j = i;
      let hasColDollar = false;
      if (input[j] === '$') {
        hasColDollar = true;
        j++;
        if (!isAlpha(input[j] ?? '')) {
          throw new FormulaError('#VALUE!', '无法识别的字符 $', start, 1);
        }
      }
      if (!isAlpha(input[j] ?? '')) {
        throw new FormulaError('#VALUE!', '无法识别的字符 $', start, 1);
      }
      while (j < n && isAlpha(input[j])) j++;
      let hasRowDollar = false;
      if (input[j] === '$') {
        hasRowDollar = true;
        j++;
        if (!isDigit(input[j] ?? '')) {
          throw new FormulaError('#REF!', '$ 后应为行号', j - 1, 1);
        }
      }
      if (isDigit(input[j] ?? '')) {
        while (j < n && isDigit(input[j])) j++;
        const word = input.slice(start, j);
        if (!looksLikeRef(word)) {
          throw new FormulaError('#REF!', `无效的引用: ${word}`, start, j - start);
        }
        i = j;
        void hasColDollar;
        void hasRowDollar;
        push('ref', start, i);
        continue;
      }
      if (hasColDollar || hasRowDollar) {
        throw new FormulaError('#REF!', `无效的引用: ${input.slice(start, j)}`, start, j - start);
      }

      // 纯字母：布尔 / 函数名 / 裸标识符
      i = j;
      const word = input.slice(start, i);
      const upper = word.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        push('bool', start, i);
      } else {
        push('ident', start, i);
      }
      continue;
    }

    // 括号 / 逗号 / 百分号
    if (c === '(') {
      push('lparen', i, i + 1);
      i++;
      continue;
    }
    if (c === ')') {
      push('rparen', i, i + 1);
      i++;
      continue;
    }
    if (c === ',') {
      push('comma', i, i + 1);
      i++;
      continue;
    }
    if (c === ';') {
      // 兼容分号作为参数分隔符
      push('comma', i, i + 1);
      i++;
      continue;
    }
    if (c === ':') {
      push('colon', i, i + 1);
      i++;
      continue;
    }
    if (c === '%') {
      push('percent', i, i + 1);
      i++;
      continue;
    }

    // 多字符运算符
    const two = input.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      push('op', i, i + 2);
      i += 2;
      continue;
    }
    if ('+-*/^&=<>'.includes(c)) {
      push('op', i, i + 1);
      i++;
      continue;
    }

    throw new FormulaError('#VALUE!', `无法识别的字符: ${c}`, i, 1);
  }

  push('eof', n, n);
  return tokens;
}
