/**
 * aggregator.js
 * 時間軸グラフ用のデータ集約・ダウンサンプリングエンジン
 *
 * グラフ仕様:
 * - プロット点数は 600点 固定
 * - スケール:
 *   - 10m: 10分 (600秒) -> 1秒間隔 (Δt = 1)
 *   - 1h:  1時間 (3600秒) -> 6秒間隔 (Δt = 6)
 *   - 6h:  6時間 (21600秒) -> 36秒間隔 (Δt = 36)
 *   - 24h: 24時間 (86400秒) -> 144秒間隔 (Δt = 144)
 *   - 7d:  7日間 (604800秒) -> 1008秒間隔 (Δt = 1008)
 * - 600点に満たない左側の未到達部分は null
 * - 右端（インデックス599）は常に1秒ごとの最新データ
 * - Δt秒ごとにスクロールし、直近Δt秒間の平均値がインデックス598へ確定される
 * - 平均化ルール:
 *   - 風速・気温: 算術平均（計測エラー時は風速・風向を除外）
 *   - 風向: ベクトル平均（atan2(sum(sin), sum(cos))）
 */

export const TIME_SCALES = {
  '10m': { label: '10分間', durationSec: 600, intervalSec: 1 },
  '1h':  { label: '1時間',  durationSec: 3600, intervalSec: 6 },
  '6h':  { label: '6時間',  durationSec: 21600, intervalSec: 36 },
  '24h': { label: '24時間', durationSec: 86400, intervalSec: 144 },
  '7d':  { label: '7日間',  durationSec: 604800, intervalSec: 1008 }
};

export const PLOT_COUNT = 600;

/**
 * 角度配列のベクトル平均を計算する
 * @param {number[]} angles - 有効な角度(0-359)の配列
 * @returns {number|null} 0〜359の平均角度。データが空の場合はnull
 */
export function calculateVectorMeanDirection(angles) {
  if (!angles || angles.length === 0) return null;

  let sumSin = 0;
  let sumCos = 0;

  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }

  // ベクトルの長さがほぼ0の場合は直前の値またはnull
  if (Math.abs(sumSin) < 1e-7 && Math.abs(sumCos) < 1e-7) {
    return angles[0];
  }

  let meanRad = Math.atan2(sumSin, sumCos);
  let meanDeg = (meanRad * 180) / Math.PI;
  if (meanDeg < 0) meanDeg += 360;

  return Math.round(meanDeg) % 360;
}

/**
 * パケットの配列から平均プロット点({ speed, direction, temperature, isError, timestamp })を計算
 * @param {Array} packets
 * @returns {object|null}
 */
export function calculateAveragePoint(packets) {
  if (!packets || packets.length === 0) return null;

  const validSpeeds = [];
  const validDirs = [];
  const temps = [];

  let lastTimestamp = packets[packets.length - 1].timestamp;

  for (const p of packets) {
    if (!p.isValid) continue;

    temps.push(p.temperature);

    if (!p.isError) {
      validSpeeds.push(p.speed);
      validDirs.push(p.direction);
    }
  }

  if (temps.length === 0) return null;

  // 気温の算術平均
  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;

  // 風速の算術平均、最大値、最小値、中央値（全件エラーの場合は null または 99.9）
  let avgSpeed = null;
  let minSpeed = null;
  let maxSpeed = null;
  let medianSpeed = null;
  let avgDir = null;
  let isError = false;

  if (validSpeeds.length > 0) {
    avgSpeed = validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length;
    minSpeed = Math.min(...validSpeeds);
    maxSpeed = Math.max(...validSpeeds);

    const sortedSpeeds = [...validSpeeds].sort((a, b) => a - b);
    const mid = Math.floor(sortedSpeeds.length / 2);
    if (sortedSpeeds.length % 2 === 1) {
      medianSpeed = sortedSpeeds[mid];
    } else {
      medianSpeed = (sortedSpeeds[mid - 1] + sortedSpeeds[mid]) / 2;
    }

    avgDir = calculateVectorMeanDirection(validDirs);
  } else {
    isError = true;
    avgSpeed = 99.9;
    minSpeed = 99.9;
    maxSpeed = 99.9;
    medianSpeed = 99.9;
    avgDir = null;
  }

  return {
    timestamp: lastTimestamp,
    speed: avgSpeed !== null ? parseFloat(avgSpeed.toFixed(1)) : null,
    speedMin: minSpeed !== null ? parseFloat(minSpeed.toFixed(1)) : null,
    speedMax: maxSpeed !== null ? parseFloat(maxSpeed.toFixed(1)) : null,
    speedMedian: medianSpeed !== null ? parseFloat(medianSpeed.toFixed(1)) : null,
    direction: avgDir,
    temperature: parseFloat(avgTemp.toFixed(1)),
    isError
  };
}

export class ChartAggregator {
  constructor(timeScaleKey = '10m') {
    this.timeScaleKey = timeScaleKey;
    this.config = TIME_SCALES[timeScaleKey] || TIME_SCALES['10m'];

    // 確定済みプロット配列 (スロット数 599点固定、インデックス 0〜598)
    // 左端(0)が最も古いスロット、右側(598)が最新確定スロット
    this.committedPoints = new Array(PLOT_COUNT - 1).fill(null);

    // 現在のインターバル期間内に受信した一時パケット群
    this.currentIntervalPackets = [];

    // 最新の未平均化リアルタイム生パケット（右端用、インデックス599）
    this.latestPacket = null;

    // リアルタイム集約用の直前バケットID
    this.lastBucketId = null;
  }

  /**
   * 時間スケールを変更
   * @param {string} newScaleKey ('10m', '1h', '6h', '24h', '7d')
   * @param {Array} historyPackets - スケール再構築用の過去全パケット配列（あれば）
   */
  setScale(newScaleKey, historyPackets = []) {
    if (!TIME_SCALES[newScaleKey]) return;
    this.timeScaleKey = newScaleKey;
    this.config = TIME_SCALES[newScaleKey];

    // 過去履歴パケットから再構築
    this.rebuildFromHistory(historyPackets);
  }

  /**
   * 1秒ごとに新しいパケットを追加
   * @param {object} packet - parsePacket の結果
   */
  addPacket(packet) {
    if (!packet || !packet.isValid) return;

    const intervalSec = this.config.intervalSec;
    const intervalMs = intervalSec * 1000;
    const pTime = packet.timestamp instanceof Date ? packet.timestamp.getTime() : new Date(packet.timestamp).getTime();
    const bucketId = Math.floor(pTime / intervalMs);

    this.latestPacket = packet;

    if (this.lastBucketId === null) {
      this.lastBucketId = bucketId;
      this.currentIntervalPackets = [packet];
      return;
    }

    if (bucketId === this.lastBucketId) {
      // 同一インターバル内: パケットを追加
      this.currentIntervalPackets.push(packet);
    } else if (bucketId > this.lastBucketId) {
      // インターバルが進んだ: 前のインターバルの平均値を確定点としてスロットへ追加
      const avgPoint = calculateAveragePoint(this.currentIntervalPackets);
      this.committedPoints.shift();
      this.committedPoints.push(avgPoint);

      // 直前インターバルの最終パケット時刻との差分を算出
      const lastPacket = this.currentIntervalPackets[this.currentIntervalPackets.length - 1];
      const lastPTime = lastPacket.timestamp instanceof Date
        ? lastPacket.timestamp.getTime()
        : new Date(lastPacket.timestamp).getTime();
      const elapsedMs = pTime - lastPTime;

      // 通信途絶等で複数バケット進んだ場合は未計測スロットを null で埋める
      // ただし1秒周期のクロックドリフトやタイマージッターによりバケット境界を跨いだだけ
      // （パケット欠落なし・連続受信中）の場合は、チャートの途切れを防ぐため直前の確定値で補完する
      const missedBuckets = bucketId - this.lastBucketId - 1;
      const skipCount = Math.min(missedBuckets, PLOT_COUNT - 1);
      const isContinuous = avgPoint !== null && elapsedMs <= 3500 && skipCount <= 2;

      for (let i = 0; i < skipCount; i++) {
        this.committedPoints.shift();
        this.committedPoints.push(isContinuous ? { ...avgPoint } : null);
      }

      this.lastBucketId = bucketId;
      this.currentIntervalPackets = [packet];
    }
  }

  /**
   * グラフ描画用の 600点 固定配列を取得する
   * - インデックス 0〜598: 過去の確定平均データ（足りない左側や未計測期間は null）
   * - インデックス 599: 最新の1秒生パケット
   * @returns {Array<object|null>} 長さ600の配列
   */
  getPlotData() {
    const result = new Array(PLOT_COUNT).fill(null);

    // 最新パケット（右端 インデックス 599）
    if (this.latestPacket) {
      const sp = this.latestPacket.speed;
      result[PLOT_COUNT - 1] = {
        timestamp: this.latestPacket.timestamp,
        speed: sp,
        speedMin: sp,
        speedMax: sp,
        speedMedian: sp,
        direction: this.latestPacket.direction,
        temperature: this.latestPacket.temperature,
        isError: this.latestPacket.isError
      };
    }

    // 確定済みポイント (インデックス 0〜598)
    for (let i = 0; i < PLOT_COUNT - 1; i++) {
      result[i] = this.committedPoints[i];
    }

    return result;
  }

  /**
   * 過去ログから確定ポイントを再集計・再構築する（スケール変更時など）
   * タイムバケット（絶対時刻の時間窓）に基づき、空白期間は正しく null スロットとして配置する
   * @param {Array} packets - 時系列順の生パケット配列
   */
  rebuildFromHistory(packets) {
    this.committedPoints = new Array(PLOT_COUNT - 1).fill(null);
    this.currentIntervalPackets = [];
    this.latestPacket = null;
    this.lastBucketId = null;

    if (!packets || packets.length === 0) return;

    const validPackets = packets.filter((p) => p && p.isValid);
    if (validPackets.length === 0) return;

    validPackets.sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return ta - tb;
    });

    const latest = validPackets[validPackets.length - 1];
    this.latestPacket = latest;

    const intervalSec = this.config.intervalSec;
    const intervalMs = intervalSec * 1000;
    const latestMs = latest.timestamp instanceof Date ? latest.timestamp.getTime() : new Date(latest.timestamp).getTime();
    const latestBucket = Math.floor(latestMs / intervalMs);
    this.lastBucketId = latestBucket;

    // バケットIDごとにパケットをグループ化
    const bucketMap = new Map();
    for (const p of validPackets) {
      const pTime = p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime();
      const bId = Math.floor(pTime / intervalMs);
      if (!bucketMap.has(bId)) {
        bucketMap.set(bId, []);
      }
      bucketMap.get(bId).push(p);
    }

    // 最新バケットは現在進行中のインターバル
    this.currentIntervalPackets = bucketMap.get(latestBucket) || [];

    // latestBucket より過去のバケットを各時間スロットにマッピング
    // diff = 1 (1つ前のバケット) => スロット 598
    // diff = 2 (2つ前のバケット) => スロット 597
    // ...
    // diff = k => スロット PLOT_COUNT - 1 - diff
    for (const [bId, bPackets] of bucketMap.entries()) {
      const diff = latestBucket - bId;
      if (diff > 0 && diff < PLOT_COUNT) {
        const slotIdx = PLOT_COUNT - 1 - diff;
        this.committedPoints[slotIdx] = calculateAveragePoint(bPackets);
      }
    }

    // 1秒周期のクロックドリフトやタイマージッターでバケット境界を跨いだことによる単発の空白スロットを補完
    const maxSlots = PLOT_COUNT - 1;
    let i = 0;
    while (i < maxSlots) {
      if (this.committedPoints[i] === null) {
        let gapEnd = i;
        while (gapEnd < maxSlots && this.committedPoints[gapEnd] === null) {
          gapEnd++;
        }
        const gapLength = gapEnd - i;
        const prevPoint = i > 0 ? this.committedPoints[i - 1] : null;
        const nextPoint = gapEnd < maxSlots ? this.committedPoints[gapEnd] : this.latestPacket;

        if (prevPoint && nextPoint && gapLength <= 2) {
          const prevMs = prevPoint.timestamp instanceof Date
            ? prevPoint.timestamp.getTime()
            : new Date(prevPoint.timestamp).getTime();
          const nextMs = nextPoint.timestamp instanceof Date
            ? nextPoint.timestamp.getTime()
            : new Date(nextPoint.timestamp).getTime();

          if (nextMs - prevMs <= 3500) {
            for (let k = i; k < gapEnd; k++) {
              this.committedPoints[k] = { ...prevPoint };
            }
          }
        }
        i = gapEnd;
      } else {
        i++;
      }
    }
  }
}
