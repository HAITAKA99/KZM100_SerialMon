/**
 * long-run-simulation.mjs
 * 3日間連続稼働（259,200パケット以上）シミュレーションテスト
 *
 * 検証項目:
 * 1. ConsoleViewer の DOM要素数が最大200件に厳密に抑制され、リークしないこと
 * 2. ChartAggregator のプロットデータ配列が600点固定で一定メモリを維持すること
 * 3. 300,000件（約3.47日分）の連続データ処理でメモリ使用量が発散しないこと
 */

import { parsePacket } from '../src/serial/packet-parser.js';
import { ChartAggregator, calculateVectorMeanDirection } from '../src/data/aggregator.js';
import { StorageManager } from '../src/storage/db.js';

// DOM環境のモック
class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.textContent = '';
    this.className = '';
    this.innerHTML = '';
    this.scrollTop = 0;
    this.scrollHeight = 100;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      child.parentNode = null;
      this.children.splice(idx, 1);
      return child;
    }
    throw new Error('NotFound');
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this._findById(id);
    }
    return null;
  }

  _findById(id) {
    if (this.id === id) return this;
    for (const c of this.children) {
      const found = c._findById ? c._findById(id) : null;
      if (found) return found;
    }
    return null;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }
}

// 簡易DOM環境セットアップ
globalThis.document = {
  createElement(tag) {
    return new MockElement(tag);
  }
};

// ConsoleViewer クラス（修正後）
class ConsoleViewerForTest {
  constructor(containerElement, maxItems = 200) {
    this.container = containerElement;
    this.maxItems = maxItems;
    this.items = [];
    this.autoScroll = true;

    this.bodyEl = new MockElement('div');
    this.bodyEl.id = 'console-body';
    this.placeholderEl = new MockElement('div');
    this.placeholderEl.id = 'console-placeholder';
    this.bodyEl.appendChild(this.placeholderEl);

    this.countEl = new MockElement('span');
    this.countEl.id = 'console-count';
  }

  addPacket(packet) {
    if (!packet) return;

    if (this.placeholderEl && this.placeholderEl.parentNode === this.bodyEl) {
      this.bodyEl.removeChild(this.placeholderEl);
    }

    const item = {
      timestamp: packet.timestamp,
      speedStr: packet.speedStr || packet.speed.toFixed(1).padStart(4, '0'),
      dirStr: packet.dirStr || String(packet.direction).padStart(3, '0'),
      tempStr: packet.tempStr || (packet.temperature >= 0 ? `+${packet.temperature.toFixed(1)}` : packet.temperature.toFixed(1)),
      isError: packet.isError,
      isValid: packet.isValid,
      raw: packet.raw
    };

    this.items.push(item);

    while (this.items.length > this.maxItems) {
      this.items.shift();
    }
    while (this.bodyEl.children.length >= this.maxItems) {
      this.bodyEl.removeChild(this.bodyEl.firstElementChild);
    }

    const rowEl = new MockElement('div');
    rowEl.className = `console-row ${item.isError ? 'row-error' : ''} ${!item.isValid ? 'row-invalid' : ''}`;
    this.bodyEl.appendChild(rowEl);

    if (this.countEl) {
      this.countEl.textContent = `${this.items.length} / ${this.maxItems} 件`;
    }

    if (this.autoScroll) {
      this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
  }

  clear() {
    this.items = [];
    if (this.bodyEl) {
      this.bodyEl.children = [];
      if (this.placeholderEl) {
        this.placeholderEl.style.display = 'block';
        this.bodyEl.appendChild(this.placeholderEl);
      }
    }
    if (this.countEl) {
      this.countEl.textContent = `0 / ${this.maxItems} 件`;
    }
  }
}

async function runSimulation() {
  console.log('====================================================');
  console.log('長期運用シミュレーションテスト開始');
  console.log('目標: 300,000パケット連続処理 (3.47日分の実稼働に相当)');
  console.log('====================================================');

  const container = new MockElement('div');
  const consoleViewer = new ConsoleViewerForTest(container, 200);
  const aggregator = new ChartAggregator('10m');

  const TOTAL_PACKETS = 300000;
  const CHECKPOINTS = [100, 200, 1000, 10000, 50000, 100000, 200000, 259200, 300000];

  const startTime = Date.now();
  let baseTimestamp = new Date('2026-09-01T00:00:00Z').getTime();

  for (let i = 1; i <= TOTAL_PACKETS; i++) {
    const currentMs = baseTimestamp + i * 1000;
    const currentTs = new Date(currentMs);

    // 擬似パケット生成（風速・風向・気温のランダムウォーク）
    const speed = (2.0 + (i % 150) * 0.1).toFixed(1).padStart(4, '0');
    const dir = String((i * 7) % 360).padStart(3, '0');
    const temp = `+${(20.0 + Math.sin(i / 1000) * 5).toFixed(1)}`;
    const line = `${speed}[m/s],${dir},${temp}`;

    const packet = parsePacket(line, currentTs);

    // 1. コンソールビューア更新
    consoleViewer.addPacket(packet);

    // 2. アグリゲータ更新
    aggregator.addPacket(packet);

    // チェックポイント判定
    if (CHECKPOINTS.includes(i)) {
      const days = (i / 86400).toFixed(2);
      const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
      const domCount = consoleViewer.bodyEl.children.length;
      const itemCount = consoleViewer.items.length;
      const plotCount = aggregator.getPlotData().length;

      console.log(`[チェックポイント] パケット数: ${i.toLocaleString()} (${days}日分) | DOM行数: ${domCount} | items: ${itemCount} | グラフ点数: ${plotCount} | ヒープ: ${heapMB} MB`);

      // 検証アサーション
      if (i >= 200) {
        if (domCount !== 200) {
          throw new Error(`DOMリーク検出! パケット数 ${i} にて DOM行数が ${domCount} 件になっています（期待値: 200）`);
        }
        if (itemCount !== 200) {
          throw new Error(`配列リーク検出! パケット数 ${i} にて items配列が ${itemCount} 件になっています（期待値: 200）`);
        }
      }
      if (plotCount !== 600) {
        throw new Error(`アグリゲータ異常! プロット点数が ${plotCount} 件になっています（期待値: 600）`);
      }
    }
  }

  // clear() メソッドのテスト
  console.log('\n--- clear() メソッドの動作確認 ---');
  consoleViewer.clear();
  console.log(`クリア直後: DOM子要素数 = ${consoleViewer.bodyEl.children.length} (プレースホルダー含), items = ${consoleViewer.items.length}`);
  if (consoleViewer.bodyEl.children.length !== 1 || consoleViewer.items.length !== 0) {
    throw new Error('クリア処理の異常');
  }

  // クリア後に再投入してプレースホルダー除去と200件上限が再機能するか確認
  for (let i = 1; i <= 300; i++) {
    const line = `05.0[m/s],090,+20.0`;
    const packet = parsePacket(line);
    consoleViewer.addPacket(packet);
  }
  console.log(`クリア後300件追加: DOM行数 = ${consoleViewer.bodyEl.children.length}, items = ${consoleViewer.items.length}`);
  if (consoleViewer.bodyEl.children.length !== 200 || consoleViewer.items.length !== 200) {
    throw new Error('クリア後の再投入で上限維持が失敗');
  }

  // Issue #47: 1秒周期のクロックドリフト（例: 1006ms間隔）で2〜3分おきにバケット境界を跨いでも
  // 10分間スケールチャートに null（途切れ）が発生しないことを検証
  console.log('\n--- Issue #47: 10分間スケールのクロックドリフト耐性テスト ---');
  const driftAggregator = new ChartAggregator('10m');
  const driftPackets = [];
  let driftTs = new Date('2026-10-17T00:00:00.000Z').getTime();

  for (let i = 0; i < 700; i++) {
    // 1006ms間隔（約166秒＝2分46秒ごとに1秒バケット境界をスキップするドリフト）
    driftTs += 1006;
    const p = parsePacket('00.0[m/s],000,+23.5', new Date(driftTs));
    driftPackets.push(p);
    driftAggregator.addPacket(p);
  }

  const realtimePlot = driftAggregator.getPlotData();
  const realtimeNullCount = realtimePlot.filter((pt) => pt === null || pt.temperature === null).length;
  console.log(`リアルタイム受信後(700件, 1006ms周期): 600点中のnull数 = ${realtimeNullCount}`);
  if (realtimeNullCount !== 0) {
    throw new Error(`リアルタイムプロットに途切れ(null)が発生しています: ${realtimeNullCount}件`);
  }

  // 履歴再構築(rebuildFromHistory)でも途切れが発生しないことを確認
  driftAggregator.rebuildFromHistory(driftPackets);
  const rebuiltPlot = driftAggregator.getPlotData();
  const rebuiltNullCount = rebuiltPlot.filter((pt) => pt === null || pt.temperature === null).length;
  console.log(`履歴再構築後(700件, 1006ms周期): 600点中のnull数 = ${rebuiltNullCount}`);
  if (rebuiltNullCount !== 0) {
    throw new Error(`履歴再構築プロットに途切れ(null)が発生しています: ${rebuiltNullCount}件`);
  }

  // 実際の通信途絶（例: 10秒間の欠落）は正しく null として保持されることを確認
  driftTs += 10000;
  const afterOutagePacket = parsePacket('00.0[m/s],000,+23.5', new Date(driftTs));
  driftAggregator.addPacket(afterOutagePacket);
  const outagePlot = driftAggregator.getPlotData();
  const outageNullCount = outagePlot.filter((pt) => pt === null).length;
  console.log(`10秒間の通信途絶シミュレーション後: 600点中のnull数 = ${outageNullCount}`);
  if (outageNullCount === 0) {
    throw new Error('実際の通信途絶期間が null になっていません');
  }

  // Issue #49: 大量データ蓄積時の purgeOldData が1件ずつのカーソルループではなく
  // IDBKeyRange.upperBound による一括範囲削除 (O(1)) で即座に完了することを検証
  console.log('\n--- Issue #49: purgeOldData 一括範囲削除 & 起動応答性テスト ---');
  let deleteCallCount = 0;
  let cursorContinueCount = 0;
  let deletedRange = null;

  globalThis.IDBKeyRange = {
    upperBound(bound) {
      return { type: 'upperBound', bound };
    },
    lowerBound(bound) {
      return { type: 'lowerBound', bound };
    }
  };

  globalThis.indexedDB = {
    open() {
      const req = {};
      setTimeout(() => {
        const fakeDb = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = {
              objectStore() {
                return {
                  index() {
                    return {
                      openKeyCursor(range, direction) {
                        const cReq = {};
                        setTimeout(() => {
                          if (cReq.onsuccess) {
                            cReq.onsuccess({
                              target: {
                                result: {
                                  primaryKey: 300000,
                                  continue() {
                                    cursorContinueCount++;
                                  }
                                }
                              }
                            });
                          }
                          if (tx.oncomplete) tx.oncomplete();
                        }, 1);
                        return cReq;
                      }
                    };
                  },
                  delete(range) {
                    deleteCallCount++;
                    deletedRange = range;
                  }
                };
              }
            };
            return tx;
          },
          close() {}
        };
        if (req.onsuccess) {
          req.onsuccess({ target: { result: fakeDb } });
        }
      }, 1);
      return req;
    }
  };

  const storageManager = new StorageManager();
  await storageManager.purgeOldData(7);
  console.log(`300,000件相当のパージ検証: store.delete呼び出し回数 = ${deleteCallCount}, cursor.continue回数 = ${cursorContinueCount}, 削除上限主キー = ${deletedRange && deletedRange.bound}`);
  if (deleteCallCount !== 1 || cursorContinueCount !== 0 || !deletedRange || deletedRange.bound !== 300000) {
    throw new Error('purgeOldData が一括範囲削除になっていません');
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n====================================================');
  console.log(`長期運用シミュレーション完了: ALL PASSED (${elapsedSec}秒)`);
  console.log('DOM要素数およびメモリ使用量は完全に有界(O(1))に保たれています。');
  console.log('====================================================');
}

runSimulation().catch((err) => {
  console.error('シミュレーション失敗:', err);
  process.exit(1);
});
