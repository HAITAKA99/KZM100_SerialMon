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
      const request = indexedDB.open(DB_NAME, DB_VERSION);

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
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
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
   * @param {number} [retentionDays=7] - 保持日数
   */
  async purgeOldData(retentionDays = 7) {
    try {
      const db = await this.init();
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoffTime);

      const request = index.openCursor(range);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
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
