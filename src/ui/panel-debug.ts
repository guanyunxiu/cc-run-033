/**
 * 基础调试面板（特性 33）：耗时、图规模、AST 缓存、循环回路明细。
 */
import { state } from './state.js';
import { formatAddr } from '../core/address.js';

function graphIdToAddress(id: string): string {
  if (id.startsWith('cell@')) {
    const [col, row] = id.slice('cell@'.length).split(',').map(Number);
    return formatAddr({ row: row!, col: col! });
  }
  if (id.startsWith('formula@')) return id.slice('formula@'.length);
  return id;
}

export function renderDebugPanel(container: HTMLElement): void {
  container.innerHTML = '';
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const { timing, debug, cells } = snapshot;

  const section = (title: string): HTMLDivElement => {
    const s = document.createElement('div');
    s.className = 'debug-section';
    const h = document.createElement('h4');
    h.textContent = title;
    s.appendChild(h);
    return s;
  };
  const row = (k: string, v: string): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = 'debug-row';
    d.innerHTML = `<span class="debug-key"></span><span class="debug-val"></span>`;
    (d.querySelector('.debug-key') as HTMLElement).textContent = k;
    (d.querySelector('.debug-val') as HTMLElement).textContent = v;
    return d;
  };

  const perf = section('耗时（全量重算）');
  perf.append(
    row('解析 parse', `${timing.parseMs.toFixed(2)} ms`),
    row('建图 graph', `${timing.graphMs.toFixed(2)} ms`),
    row('拓扑 topo', `${timing.topoMs.toFixed(2)} ms`),
    row('求值 eval', `${timing.evalMs.toFixed(2)} ms`),
    row('总计 total', `${timing.totalMs.toFixed(2)} ms`),
  );
  container.appendChild(perf);

  const graphInfo = section('依赖图');
  graphInfo.append(
    row('节点数', String(debug.nodeCount)),
    row('边数', String(debug.edgeCount)),
    row('已计算单元格', String(Object.keys(cells).length)),
    row('拓扑算法', debug.topoAlgorithm.toUpperCase()),
  );
  container.appendChild(graphInfo);

  const cache = section('AST 缓存');
  cache.append(
    row('缓存条目', String(debug.astCacheSize)),
    row('命中次数', String(debug.astCacheHits)),
  );
  container.appendChild(cache);

  const cycles = section('循环检测');
  if (debug.selfLoops.length === 0 && debug.cycles.length === 0) {
    cycles.appendChild(row('状态', '无循环'));
  } else {
    for (const id of debug.selfLoops) {
      cycles.appendChild(row('自引用', graphIdToAddress(id)));
    }
    debug.cycles.forEach((path, i) => {
      const label = path.map(graphIdToAddress).join(' → ');
      // path 形如 A → B → A：内部节点数 = 去尾后的节点数 - 1
      const interior = new Set(path.slice(0, -1)).size - 1;
      const kind = interior <= 0 ? '自引用循环' : interior === 1 ? '直接循环' : '间接循环';
      cycles.appendChild(row(`回路 ${i + 1}（${kind}）`, label));
    });
  }
  container.appendChild(cycles);
}
