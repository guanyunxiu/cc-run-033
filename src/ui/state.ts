/**
 * 主线程共享 UI 状态（特性 35：只负责 UI 与渲染）。
 */
import { Snapshot, WorkerRequest, WorkerResponse } from '../engine/protocol';
import { SAMPLE_CELLS } from '../sample';

export interface Selection {
  col: number;
  row: number;
}

export interface RangeSelection {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export type SideTab = 'graph' | 'ast' | 'order' | 'errors' | 'debug';

export interface UiState {
  snapshot: Snapshot | null;
  active: Selection;
  /** 框选区域（多选的一种：连续区域） */
  box: RangeSelection | null;
  /** 按住 Ctrl/Cmd 点击形成的多选单元格键集合 */
  multi: Set<string>;
  /** 正在编辑的单元格 */
  editing: Selection | null;
  tab: SideTab;
  showRanges: boolean;
  /** 图中悬停的节点 id */
  hoverNode: string | null;
  /** 图中选中的节点 id */
  selectedGraphNode: string | null;
}

export function createInitialState(): UiState {
  return {
    snapshot: null,
    active: { col: 1, row: 1 },
    box: null,
    multi: new Set(),
    editing: null,
    tab: 'graph',
    showRanges: false,
    hoverNode: null,
    selectedGraphNode: null,
  };
}

export function cellKey(col: number, row: number): string {
  let s = '';
  let c = col;
  do {
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${s}${row + 1}`;
}

/** Worker 客户端封装：主线程唯一与引擎通信的通道。 */
export class EngineClient {
  private worker: Worker;
  private reqSeq = 0;
  private previewWaiters = new Map<
    number,
    (res: Extract<WorkerResponse, { type: 'parsePreview' }>) => void
  >();

  constructor(onSnapshot: (snapshot: Snapshot) => void) {
    this.worker = new Worker(new URL('../engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === 'snapshot') {
        onSnapshot(msg.snapshot);
      } else if (msg.type === 'parsePreview') {
        this.previewWaiters.get(msg.reqId)?.(msg);
        this.previewWaiters.delete(msg.reqId);
      }
    };
  }

  send(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }

  loadSample(): void {
    this.worker.postMessage({
      type: 'setCells',
      entries: SAMPLE_CELLS.map((c) => ({ col: c.col, row: c.row, raw: c.raw })),
    });
  }

  setCell(col: number, row: number, raw: string): void {
    this.worker.postMessage({ type: 'setCell', col, row, raw });
  }

  clear(): void {
    this.worker.postMessage({ type: 'clear' });
  }

  setAlgorithm(algorithm: 'kahn' | 'dfs'): void {
    this.worker.postMessage({ type: 'setAlgorithm', algorithm });
  }

  parsePreview(body: string): Promise<Extract<WorkerResponse, { type: 'parsePreview' }>> {
    const reqId = ++this.reqSeq;
    return new Promise((resolve) => {
      this.previewWaiters.set(reqId, resolve);
      this.worker.postMessage({ type: 'parsePreview', body, reqId });
    });
  }
}
