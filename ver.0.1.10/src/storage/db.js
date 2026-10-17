/**
 * db.js
 * IndexedDB を利用した測定データのローカル永続化（最大7日間保持 & 自動パージ）
 */

const DB_NAME = 'KazaminMonitorDB';
const DB_VERSION = 1;
const STORE_NAME = 'measurements';

export class StorageManager {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * IndexedDBの初期化・オープン
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.initPromise = null;
          reject(new Error('IndexedDB open timeout'));
        }
      }, 3000);

      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        clearTimeout(timer);
        this.initPromise = null;
        reject(err);
        return;
      }

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        if (settled) {
          event.target.result.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.db = event.target.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
          this.initPromise = null;
        };
        this.db.onclose = () => {
          this.db = null;
          this.initPromise = null;
        };
        resolve(this.db);
      };

      request.onerror = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.initPromise = null;
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.initPromise = null;
        console.warn('IndexedDB open blocked by another connection');
        reject(new Error('IndexedDB open blocked'));
      };
    });

    return this.initPromise;
  }

  /**
   * 計測パケットを1件保存
   * @param {object} packet - parsePacket の結果
   */
  async savePacket(packet) {
    if (!packet || !packet.isValid) return;

    try {
      const db = await this.init();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record = {
        timestamp: packet.timestamp instanceof Date ? packet.timestamp.getTime() : packet.timestamp,
        speed: packet.speed,
        direction: packet.direction,
        temperature: packet.temperature,
        isError: packet.isError,
        raw: packet.raw
      };

      store.add(record);
    } catch (err) {
      console.warn('Failed to save packet to IndexedDB:', err);
    }
  }

  /**
   * 指定した開始時刻以降のデータを取得
   * @param {number|Date} startTime
   * @returns {Promise<Array>}
   */
  async getSince(startTime) {
    const startMs = startTime instanceof Date ? startTime.getTime() : startTime;
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.lowerBound(startMs);
      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 保存されている全レコードを取得
   * @returns {Promise<Array>}
   */
  async getAll() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 7日以上前の古いレコードを自動削除（パージ）
   * 1件ずつのカーソル削除では大量データ蓄積時にreadwriteロックが長時間続くため、
   * 削除対象の最大主キー(id)を逆順カーソルで1件特定し、IDBKeyRange.upperBoundで一括範囲削除する
   * @param {number} [retentionDays=7] - 保持日数
   * @returns {Promise<void>}
   */
  async purgeOldData(retentionDays = 7) {
    try {
      const db = await this.init();
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const range = IDBKeyRange.upperBound(cutoffTime);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Purge transaction aborted'));

        const cursorReq = index.openKeyCursor
          ? index.openKeyCursor(range, 'prev')
          : index.openCursor(range, 'prev');

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && cursor.primaryKey !== undefined) {
            store.delete(IDBKeyRange.upperBound(cursor.primaryKey));
          }
        };
      });
    } catch (err) {
      console.warn('Failed to purge old data:', err);
    }
  }

  /**
   * 全データを削除（クリア）
   */
  async clear() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
