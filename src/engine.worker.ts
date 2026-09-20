/// <reference lib="webworker" />
/**
 * 引擎 Worker（特性 34、35）。
 * 所有公式词法/语法分析、求值、依赖图构建、重算都在此线程完成，
 * 主线程通过 postMessage 收发快照，仅负责 UI 与 SVG 渲染。
 */
import type { AstNode } from './engine/ast';
import { astToTreeText } from './engine/ast';
import { Parser } from './engine/parser';
import { serializeResult, WorkerRequest, WorkerResponse } from './engine/protocol';
import { Workbook } from './engine/workbook';

const workbook = new Workbook();

function send(response: WorkerResponse): void {
  ;(self as unknown as Worker).postMessage(response);
}

function recompute(): void {
  const start = performance.now();
  const result = workbook.recalc();
  const ms = performance.now() - start;
  send({ type: 'snapshot', snapshot: serializeResult(result, ms) });
}

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'setCell':
      workbook.setCell(msg.col, msg.row, msg.raw);
      recompute();
      break;
    case 'setCells':
      for (const e of msg.entries) workbook.setCell(e.col, e.row, e.raw);
      recompute();
      break;
    case 'clear':
      workbook.clear();
      recompute();
      break;
    case 'setAlgorithm':
      workbook.setAlgorithm(msg.algorithm);
      recompute();
      break;
    case 'parsePreview': {
      const { ast, error } = Parser.parseFormula(msg.body);
      send({
        type: 'parsePreview',
        reqId: msg.reqId,
        astTree: ast ? astTreeOf(ast) : null,
        error: error
          ? {
              message: error.message,
              offset: error.offset,
              length: error.length,
              column: error.column,
            }
          : null,
      });
      break;
    }
  }
};

function astTreeOf(ast: AstNode): string {
  return astToTreeText(ast);
}
