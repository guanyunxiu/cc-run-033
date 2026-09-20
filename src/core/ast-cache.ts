/**
 * AST 缓存（技术 10）。
 *
 * 以公式源码为 key 缓存解析结果，避免重复词法/语法分析。
 * 解析失败同样缓存错误，保证相同输入不重复抛错开销。
 */
import type { A1Node, FormulaError } from './types.js';
import { parseFormula } from './parser.js';

export interface CacheEntry {
  ast?: A1Node;
  error?: FormulaError;
}

export class AstCache {
  private readonly map = new Map<string, CacheEntry>();
  private hits = 0;

  get(formula: string): CacheEntry {
    const hit = this.map.get(formula);
    if (hit) {
      this.hits++;
      return hit;
    }
    const entry: CacheEntry = {};
    try {
      entry.ast = parseFormula(formula);
    } catch (e) {
      entry.error = e as FormulaError;
    }
    this.map.set(formula, entry);
    return entry;
  }

  get size(): number {
    return this.map.size;
  }

  get hitCount(): number {
    return this.hits;
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
  }
}
