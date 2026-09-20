/// <reference lib="webworker" />
/**
 * 计算 Worker（特性 34）：
 * 解析、求值、依赖图构建、拓扑与重算全部在此线程完成，
 * 主线程只负责 UI 与 SVG 渲染（特性 35）。
 */
import { WorkbookEngine } from '../core/workbook.js';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const ROWS = 100;
const COLS = 26;

const engine = new WorkbookEngine({ rows: ROWS, cols: COLS, topoAlgorithm: 'kahn' });
let requestId = 0;

function send(message: WorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

function recalcAndReply(id: number): void {
  const snapshot = engine.recalc();
  send({ type: 'snapshot', snapshot, requestId: id });
}

self.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const msg = e.data;
  switch (msg.type) {
    case 'set-cell':
      engine.setCell(msg.row, msg.col, msg.raw);
      requestId++;
      recalcAndReply(requestId);
      break;
    case 'load':
      engine.loadAll(msg.entries);
      requestId++;
      recalcAndReply(requestId);
      break;
    case 'set-algorithm':
      engine.topoAlgorithm = msg.algorithm;
      requestId++;
      recalcAndReply(requestId);
      break;
    case 'recalc':
      requestId++;
      recalcAndReply(requestId);
      break;
  }
};

send({ type: 'ready' });
