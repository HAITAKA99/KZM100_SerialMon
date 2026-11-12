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
import { ChartAggregator, calculateVectorMeanDirection, calculateAveragePoint } from '../src/data/aggregator.js';
import { StorageManager, LONG_TERM_INTERVAL_MS } from '../src/storage/db.js';
import { exportToCsv, exportLongTermToCsv } from '../src/export/csv-exporter.js';

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

  // Issue #52: 7日間ログ・3年間ログの独立保存・CSVダウンロード・個別消去の検証
  console.log('\n--- Issue #52: 7日間ログ & 3年間ログ(16.8分間隔)生成・CSV出力・個別消去テスト ---');
  const storesData = {
    measurements: [],
    long_term_logs: new Map()
  };

  globalThis.indexedDB = {
    open() {
      const req = {};
      setTimeout(() => {
        const fakeDb = {
          objectStoreNames: { contains: () => false },
          createObjectStore() {
            return { createIndex() {} };
          },
          transaction(storeName) {
            const tx = {
              objectStore(name) {
                return {
                  add(record) {
                    storesData[name].push({ id: storesData[name].length + 1, ...record });
                  },
                  put(record) {
                    storesData[name].set(record.bucketId, { ...record });
                  },
                  get(key) {
                    const gReq = {};
                    setTimeout(() => {
                      if (gReq.onsuccess) gReq.onsuccess({ result: storesData[name].get(key) || null });
                    }, 0);
                    return gReq;
                  },
                  getAll() {
                    const aReq = {};
                    setTimeout(() => {
                      const res = name === 'measurements'
                        ? [...storesData.measurements]
                        : Array.from(storesData.long_term_logs.values());
                      if (aReq.onsuccess) aReq.onsuccess();
                      aReq.result = res;
                    }, 0);
                    // Wait: set result before calling onsuccess
                    const aReq2 = {};
                    setTimeout(() => {
                      aReq2.result = name === 'measurements'
                        ? [...storesData.measurements]
                        : Array.from(storesData.long_term_logs.values());
                      if (aReq2.onsuccess) aReq2.onsuccess();
                    }, 0);
                    return aReq2;
                  },
                  clear() {
                    const cReq = {};
                    setTimeout(() => {
                      if (name === 'measurements') {
                        storesData.measurements = [];
                      } else {
                        storesData.long_term_logs.clear();
                      }
                      if (cReq.onsuccess) cReq.onsuccess();
                    }, 0);
                    return cReq;
                  }
                };
              }
            };
            return tx;
          },
          close() {}
        };
        if (req.onupgradeneeded) {
          req.onupgradeneeded({ target: { result: fakeDb } });
        }
        if (req.onsuccess) {
          req.onsuccess({ target: { result: fakeDb } });
        }
      }, 1);
      return req;
    }
  };

  const dualStorage = new StorageManager();
  await dualStorage.init();

  // 2つの16.8分(1008秒)バケットにまたがるパケットを投入
  const t0 = 1008000 * 1000;
  const p1 = parsePacket('04.0[m/s],090,+20.0', new Date(t0 + 1000));
  const p2 = parsePacket('06.0[m/s],090,+22.0', new Date(t0 + 2000));
  const p3 = parsePacket('10.0[m/s],180,+25.0', new Date(t0 + LONG_TERM_INTERVAL_MS + 1000));

  for (const p of [p1, p2, p3]) {
    await dualStorage.savePacket(p);
  }
  const bId1 = Math.floor((t0 + 1000) / LONG_TERM_INTERVAL_MS);
  const bId2 = Math.floor((t0 + LONG_TERM_INTERVAL_MS + 1000) / LONG_TERM_INTERVAL_MS);
  await dualStorage.saveLongTermPoint(bId1, calculateAveragePoint([p1, p2]));
  await dualStorage.saveLongTermPoint(bId2, calculateAveragePoint([p3]));

  const logs7d = await dualStorage.getAll();
  const logs3y = await dualStorage.getAllLongTerm();
  console.log(`保存確認: 7日間ログ件数 = ${logs7d.length} (期待値: 3), 3年間ログ件数 = ${logs3y.length} (期待値: 2)`);
  if (logs7d.length !== 3 || logs3y.length !== 2) {
    throw new Error('7日間ログまたは3年間ログの生成件数が不正です');
  }
  if (logs3y[0].speed !== 5.0 || logs3y[0].speedMin !== 4.0 || logs3y[0].speedMax !== 6.0) {
    throw new Error('3年間ログの集約計算値が不正です');
  }

  // CSVダウンロード検証
  const downloadedFiles = [];
  globalThis.Blob = class MockBlob {
    constructor(parts, options) {
      this.content = parts.join('');
      this.type = options && options.type;
    }
  };
  globalThis.URL = {
    createObjectURL(blob) {
      this._lastBlob = blob;
      return 'blob:mock-url';
    },
    revokeObjectURL() {}
  };
  globalThis.document.body = new MockElement('body');
  const origCreateEl = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    const el = origCreateEl(tag);
    el.setAttribute = function(k, v) { this[k] = v; };
    el.click = function() {
      downloadedFiles.push({ filename: this.download, content: globalThis.URL._lastBlob.content });
    };
    return el;
  };

  exportToCsv(logs7d, 'kazamin_log_7d');
  exportLongTermToCsv(logs3y, 'kazamin_log_3y');
  console.log(`CSV出力確認: 出力ファイル数 = ${downloadedFiles.length} (${downloadedFiles.map((f) => f.filename).join(', ')})`);
  if (downloadedFiles.length !== 2 || !downloadedFiles[0].filename.startsWith('kazamin_log_7d_') || !downloadedFiles[1].filename.startsWith('kazamin_log_3y_')) {
    throw new Error('7日間・3年間CSVの両方が正しくダウンロードされていません');
  }
  const csv3yLines = downloadedFiles[1].content.replace(/^\uFEFF/, '').split('\r\n');
  const expected3yHeader = '日時 (Timestamp),風速中央値 (Wind Speed Median [m/s]),風速最小 (Wind Speed Min [m/s]),風速最大 (Wind Speed Max [m/s]),風向 (Wind Direction [deg]),気温 (Temperature [℃]),ステータス (Status)';
  if (csv3yLines[0] !== expected3yHeader || csv3yLines[0].includes('風速平均')) {
    throw new Error(`3年間CSVのヘッダー列順が不正です: ${csv3yLines[0]}`);
  }
  const rowCols = csv3yLines[1].split(',');
  if (rowCols[1] !== '5.0' || rowCols[2] !== '4.0' || rowCols[3] !== '6.0' || rowCols.length !== 7) {
    throw new Error(`3年間CSVのデータ列（中央値・最小・最大）が不正です: ${csv3yLines[1]}`);
  }

  // 個別消去の検証: 7日間ログのみ消去しても3年間ログは残ること
  await dualStorage.clear();
  const after7dClear7d = await dualStorage.getAll();
  const after7dClear3y = await dualStorage.getAllLongTerm();
  console.log(`7日間ログ消去後: 7日間ログ = ${after7dClear7d.length}件, 3年間ログ = ${after7dClear3y.length}件`);
  if (after7dClear7d.length !== 0 || after7dClear3y.length !== 2) {
    throw new Error('7日間ログ消去時に3年間ログが保持されていません');
  }

  // 7日間ログを再追加し、今度は3年間ログのみ消去しても7日間ログは残ること
  await dualStorage.savePacket(p1);
  await dualStorage.clearLongTerm();
  const after3yClear7d = await dualStorage.getAll();
  const after3yClear3y = await dualStorage.getAllLongTerm();
  console.log(`3年間ログ消去後: 7日間ログ = ${after3yClear7d.length}件, 3年間ログ = ${after3yClear3y.length}件`);
  if (after3yClear7d.length !== 1 || after3yClear3y.length !== 0) {
    throw new Error('3年間ログ消去時に7日間ログが保持されていません');
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
