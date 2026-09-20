/**
 * 主线程侧 Worker 客户端（技术 4、5）。
 */
import EngineWorker from './worker/engine.worker.ts?worker';
import type { EngineSnapshot } from './core/types.js';

export class WorkbookEngineWorker {
  private readonly worker: Worker;

  constructor(onSnapshot: (snapshot: EngineSnapshot) => void) {
    this.worker = new EngineWorker();
    this.worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'snapshot') {
        onSnapshot(e.data.snapshot as EngineSnapshot);
      }
    };
  }

  setCell(row: number, col: number, raw: string): void {
    this.worker.postMessage({ type: 'set-cell', row, col, raw });
  }

  load(entries: Array<{ row: number; col: number; raw: string }>): void {
    this.worker.postMessage({ type: 'load', entries });
  }

  setAlgorithm(algorithm: 'kahn' | 'dfs'): void {
    this.worker.postMessage({ type: 'set-algorithm', algorithm });
  }

  recalc(): void {
    this.worker.postMessage({ type: 'recalc' });
  }
}
