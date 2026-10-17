/**
 * time-series-chart.js
 * 600点固定描画のリアルタイム統合時系列グラフ（HTML5 Canvas実装）
 *
 * 仕様:
 * - 3系列（風速・風向・気温）を1つの統合チャートに集約描画
 *   - 気温 [℃]: ラインチャート（左軸ラベル・目盛り）
 *   - 風速 [m/s]: ラインチャート（右軸ラベル・目盛り）
 *   - 風向 [deg]: 散布図（点プロット、右軸ラベル・目盛り）
 * - 600点固定配列（データ未達の左側は null で空白描画）
 * - 右端（index 599）が最新の1秒データ
 * - 時間スケール切替: 10分, 1時間, 6時間, 24時間, 7日間
 * - 風速スケール切替: 5, 10, 20, 30 m/s
 * - 気温スケール切替: -10〜+50℃ (default), -20〜+65℃ (max)
 */

import { TIME_SCALES, PLOT_COUNT } from '../data/aggregator.js';

export const TIME_AXIS_LABELS = {
  '10m': ['10分前', '5分前', '現在'],
  '1h':  ['60分前', '50分前', '40分前', '30分前', '20分前', '10分前', '現在'],
  '6h':  ['6時間前', '5時間前', '4時間前', '3時間前', '2時間前', '1時間前', '現在'],
  '24h': ['24時間前', '20時間前', '16時間前', '12時間前', '8時間前', '4時間前', '現在'],
  '7d':  ['7日前', '6日前', '5日前', '4日前', '3日前', '2日前', '1日前', '現在']
};

export class TimeSeriesChart {
  /**
   * @param {HTMLElement} containerElement
   * @param {object} options
   */
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.timeScale = '10m';
    this.speedScale = 10; // 5, 10, 20, 30
    this.tempScale = 'default'; // 'default' (-10〜+50), 'max' (-20〜+65)

    this.onSpeedScaleChange = options.onSpeedScaleChange || null;
    this.onTempScaleChange = options.onTempScaleChange || null;
    this.onTimeScaleChange = options.onTimeScaleChange || null;

    this.plotData = new Array(PLOT_COUNT).fill(null);

    this.render();
    this._setupCanvas();
    this._bindEvents();

    window.addEventListener('resize', () => {
      this._resizeCanvas();
      this.draw();
    });

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this._resizeCanvas();
        this.draw();
      });
      this.resizeObserver.observe(this.wrapper);
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="chart-panel">
        <div class="chart-controls-bar">
          <div class="control-group">
            <div class="btn-group" id="time-scale-group">
              <button type="button" class="btn-scale active" data-scale="10m">10分間</button>
              <button type="button" class="btn-scale" data-scale="1h">1時間</button>
              <button type="button" class="btn-scale" data-scale="6h">6時間</button>
              <button type="button" class="btn-scale" data-scale="24h">24時間</button>
              <button type="button" class="btn-scale" data-scale="7d">7日間</button>
            </div>
          </div>

          <div class="control-group">
            <div class="btn-group" id="speed-scale-group">
              <button type="button" class="btn-scale" data-speed="5">5 m/s</button>
              <button type="button" class="btn-scale active" data-speed="10">10 m/s</button>
              <button type="button" class="btn-scale" data-speed="20">20 m/s</button>
              <button type="button" class="btn-scale" data-speed="30">30 m/s</button>
            </div>
          </div>

          <div class="control-group">
            <div class="btn-group" id="temp-scale-group">
              <button type="button" class="btn-scale active" data-temp="default">-10〜+50℃</button>
              <button type="button" class="btn-scale" data-temp="max">-20〜+65℃</button>
            </div>
          </div>
        </div>

        <div class="chart-canvas-wrapper" id="chart-canvas-wrapper">
          <canvas id="time-series-canvas"></canvas>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('#time-series-canvas');
    this.wrapper = this.container.querySelector('#chart-canvas-wrapper');
    this.ctx = this.canvas.getContext('2d');
  }

  _setupCanvas() {
    this._resizeCanvas();
    this.draw();
  }

  _resizeCanvas() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(160, Math.floor(rect.height || 360));

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.width = width;
    this.height = height;
  }

  _bindEvents() {
    // 時間スケールボタン
    const timeBtns = this.container.querySelectorAll('#time-scale-group .btn-scale');
    timeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        timeBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.timeScale = btn.getAttribute('data-scale');
        if (this.onTimeScaleChange) {
          this.onTimeScaleChange(this.timeScale);
        }
        this.draw();
      });
    });

    // 風速スケールボタン
    const speedBtns = this.container.querySelectorAll('#speed-scale-group .btn-scale');
    speedBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        speedBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.speedScale = parseInt(btn.getAttribute('data-speed'), 10);
        if (this.onSpeedScaleChange) {
          this.onSpeedScaleChange(this.speedScale);
        }
        this.draw();
      });
    });

    // 気温スケールボタン
    const tempBtns = this.container.querySelectorAll('#temp-scale-group .btn-scale');
    tempBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tempBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.tempScale = btn.getAttribute('data-temp');
        if (this.onTempScaleChange) {
          this.onTempScaleChange(this.tempScale);
        }
        this.draw();
      });
    });
  }

  /**
   * データを設定して再描画
   * @param {Array<object|null>} plotData - 600点の配列
   */
  updateData(plotData) {
    if (plotData && plotData.length === PLOT_COUNT) {
      this.plotData = plotData;
      this.draw();
    }
  }

  /**
   * チャート全体の描画（統合1面チャート）
   */
  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // レイアウト計算（左右の余白を最小化してグラフ幅を最大化）
    const marginLeft = 36;
    const marginRight = 72;
    const marginTop = 28;
    const marginBottom = 28;
    const plotWidth = Math.max(100, w - marginLeft - marginRight);
    const plotHeight = Math.max(80, h - marginTop - marginBottom);
    const plotBottom = marginTop + plotHeight;

    // スケール定義
    const tempMin = this.tempScale === 'max' ? -20 : -10;
    const tempMax = this.tempScale === 'max' ? 65 : 50;

    const tTemp = {
      yMin: tempMin,
      yMax: tempMax,
      color: '#f43f5e'
    };

    const tSpeed = {
      yMin: 0,
      yMax: this.speedScale,
      color: '#00f0ff'
    };

    const tSpeedMin = {
      yMin: 0,
      yMax: this.speedScale,
      color: '#0284c7',
      lineWidth: 1.4,
      dash: [2, 2]
    };

    const tSpeedMedian = {
      yMin: 0,
      yMax: this.speedScale,
      color: '#00f0ff',
      lineWidth: 2.0,
      dash: []
    };

    const tSpeedMax = {
      yMin: 0,
      yMax: this.speedScale,
      color: '#38bdf8',
      lineWidth: 1.4,
      dash: [4, 2]
    };

    const tDir = {
      yMin: 0,
      yMax: 359,
      color: '#eab308'
    };

    // 背景・グリッド・左右軸ラベル・凡例の描画
    this._drawUnifiedBackground(ctx, marginLeft, plotWidth, plotHeight, marginTop, plotBottom, tTemp, tSpeed, tDir, tSpeedMin, tSpeedMedian, tSpeedMax);

    // データ描画（レイヤー順: 最下位=気温, 2番目=風向, 最上位=風速）
    this._drawTemperaturePlot(ctx, tTemp, marginLeft, plotWidth, plotHeight, plotBottom);
    this._drawDirectionPlot(ctx, tDir, marginLeft, plotWidth, plotHeight, plotBottom);
    this._drawSpeedPlot(ctx, tSpeed, tSpeedMin, tSpeedMedian, tSpeedMax, marginLeft, plotWidth, plotHeight, plotBottom);

    // 時間軸（横軸）の描画
    this._drawTimeAxis(ctx, marginLeft, plotWidth, plotBottom, marginTop);
  }

  /**
   * 背景グリッドと左右軸ラベル・凡例の描画
   * @private
   */
  _drawUnifiedBackground(ctx, marginLeft, plotWidth, plotHeight, marginTop, plotBottom, tTemp, tSpeed, tDir, tSpeedMin, tSpeedMedian, tSpeedMax) {
    const plotRight = marginLeft + plotWidth;

    // チャート背景
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(marginLeft, marginTop, plotWidth, plotHeight);

    // チャート外枠
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(marginLeft, marginTop, plotWidth, plotHeight);

    // --- 上部中央の凡例（気温・風速・風向、重ならないよう動的配置） ---
    // 10分スケール: 気温 [℃], 風速 [m/s], 風向 [deg]
    // 10分超スケール: 気温 [℃], 風速(最小) [m/s], 風速(中央) [m/s], 風速(最大) [m/s], 風向 [deg]
    const isShortScale = this.timeScale === '10m';
    const legendItems = isShortScale ? [
      { label: '気温 [℃]', color: tTemp.color, type: 'line' },
      { label: '風速 [m/s]', color: tSpeed.color, type: 'line' },
      { label: '風向 [deg]', color: tDir.color, type: 'dot' }
    ] : [
      { label: '気温 [℃]', color: tTemp.color, type: 'line' },
      { label: '風速(最小) [m/s]', color: tSpeedMin.color, type: 'line', dash: tSpeedMin.dash },
      { label: '風速(中央) [m/s]', color: tSpeedMedian.color, type: 'line', dash: tSpeedMedian.dash },
      { label: '風速(最大) [m/s]', color: tSpeedMax.color, type: 'line', dash: tSpeedMax.dash },
      { label: '風向 [deg]', color: tDir.color, type: 'dot' }
    ];

    const iconWidth = 14;
    const iconGap = 5;
    const fontSize = isShortScale ? 11 : (plotWidth < 540 ? 9.5 : 10.5);
    const baseItemGap = isShortScale ? 20 : (plotWidth < 540 ? 8 : 14);

    ctx.font = `bold ${fontSize}px sans-serif`;

    const measuredItems = legendItems.map((item) => ({
      ...item,
      totalItemWidth: iconWidth + iconGap + ctx.measureText(item.label).width
    }));

    const itemsTotalWidth = measuredItems.reduce((acc, it) => acc + it.totalItemWidth, 0);
    let totalLegendWidth = itemsTotalWidth + baseItemGap * (measuredItems.length - 1);

    // プロット幅を超える場合は itemGap を自動圧縮
    let actualItemGap = baseItemGap;
    if (totalLegendWidth > plotWidth - 16 && measuredItems.length > 1) {
      actualItemGap = Math.max(3, (plotWidth - 16 - itemsTotalWidth) / (measuredItems.length - 1));
      totalLegendWidth = itemsTotalWidth + actualItemGap * (measuredItems.length - 1);
    }

    const centerX = marginLeft + plotWidth / 2;
    let curX = Math.max(marginLeft + 4, centerX - totalLegendWidth / 2);
    const legendY = marginTop - 9;

    measuredItems.forEach((item) => {
      if (item.type === 'line') {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.dash && item.dash.length > 0 ? 2 : 2.5;
        if (item.dash && item.dash.length > 0) {
          ctx.setLineDash(item.dash);
        } else {
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(curX, legendY - 4);
        ctx.lineTo(curX + iconWidth, legendY - 4);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (item.type === 'dot') {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(curX + iconWidth / 2, legendY - 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = item.color;
      ctx.textAlign = 'left';
      ctx.fillText(item.label, curX + iconWidth + iconGap, legendY);

      curX += item.totalItemWidth + actualItemGap;
    });

    // --- 左右軸ヘッダー（単位・軸ラベル） ---
    ctx.font = 'bold 10px sans-serif';
    // 左側: [℃]（ライン色と同色の tTemp.color）
    ctx.fillStyle = tTemp.color;
    ctx.textAlign = 'right';
    ctx.fillText('[℃]', marginLeft - 4, marginTop - 9);

    // 右側: [m/s] および [deg]
    ctx.fillStyle = tSpeed.color;
    ctx.textAlign = 'left';
    ctx.fillText('[m/s]', plotRight + 6, marginTop - 9);

    ctx.fillStyle = tDir.color;
    ctx.fillText('[deg]', plotRight + 38, marginTop - 9);

    // --- 垂直グリッド線（時間軸区切り） ---
    const labels = TIME_AXIS_LABELS[this.timeScale] || TIME_AXIS_LABELS['10m'];
    const count = labels.length;
    if (count >= 2) {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      for (let i = 1; i < count - 1; i++) {
        const x = marginLeft + (i / (count - 1)) * plotWidth;
        ctx.beginPath();
        ctx.moveTo(x, marginTop);
        ctx.lineTo(x, plotBottom);
        ctx.stroke();
      }
    }

    // --- 水平グリッド線 & 左右目盛り数値（5分割） ---
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const fraction = i / steps;
      const y = plotBottom - plotHeight * fraction;

      // グリッド線
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();

      // 1. 左側: 気温目盛り数値 (℃)（ラインと同色）
      const tempVal = tTemp.yMin + (tTemp.yMax - tTemp.yMin) * fraction;
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = tTemp.color;
      let tempLabel = tempVal.toFixed(0);
      if (tempVal > 0) tempLabel = `+${tempLabel}`;
      ctx.fillText(tempLabel, marginLeft - 4, y + 3.5);

      // 2. 右側第1列: 風速目盛り数値 (m/s)
      const speedVal = tSpeed.yMin + (tSpeed.yMax - tSpeed.yMin) * fraction;
      ctx.textAlign = 'left';
      ctx.fillStyle = tSpeed.color;
      const speedLabel = speedVal.toFixed(tSpeed.yMax === 5 ? 1 : (speedVal % 1 === 0 ? 0 : 1));
      ctx.fillText(speedLabel, plotRight + 6, y + 3.5);

      // 3. 右側第2列: 風向目盛り数値・方位（上限359°）
      const dirVal = Math.round(tDir.yMin + (tDir.yMax - tDir.yMin) * fraction);
      ctx.fillStyle = tDir.color;
      let dirLabel = `${dirVal}°`;
      if (i === 4) dirLabel = '359°';
      if (i === 3) dirLabel = '270°';
      if (i === 2) dirLabel = '180°';
      if (i === 1) dirLabel = '90°';
      if (i === 0) dirLabel = '0°';
      ctx.fillText(dirLabel, plotRight + 38, y + 3.5);
    }
  }

  /**
   * X座標算出（index 0〜599）
   * @private
   */
  _getX(index, marginLeft, plotWidth) {
    return marginLeft + (index / (PLOT_COUNT - 1)) * plotWidth;
  }

  /**
   * 気温プロットの描画（なめらかなライン）
   * @private
   */
  _drawTemperaturePlot(ctx, tTemp, marginLeft, plotWidth, plotHeight, plotBottom) {
    const points = [];
    const span = tTemp.yMax - tTemp.yMin;

    for (let i = 0; i < PLOT_COUNT; i++) {
      const p = this.plotData[i];
      if (p && p.temperature !== null) {
        const ratio = (p.temperature - tTemp.yMin) / span;
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        points.push({
          x: this._getX(i, marginLeft, plotWidth),
          y: plotBottom - clampedRatio * plotHeight
        });
      } else {
        if (points.length > 0) {
          this._renderLine(ctx, points, tTemp.color, null, plotBottom);
          points.length = 0;
        }
      }
    }

    if (points.length > 0) {
      this._renderLine(ctx, points, tTemp.color, null, plotBottom);
    }

    // 最新値ポイントハイライト
    const latest = this.plotData[PLOT_COUNT - 1];
    if (latest && latest.temperature !== null) {
      const lx = this._getX(PLOT_COUNT - 1, marginLeft, plotWidth);
      const ratio = Math.max(0, Math.min(1, (latest.temperature - tTemp.yMin) / span));
      const ly = plotBottom - ratio * plotHeight;
      ctx.fillStyle = tTemp.color;
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 単一の風速系列（指定プロパティ）のライン描画
   * @private
   */
  _drawSpeedSeries(ctx, valueKey, strokeColor, fillColor, lineWidth, lineDash, yMax, marginLeft, plotWidth, plotHeight, plotBottom) {
    const points = [];

    for (let i = 0; i < PLOT_COUNT; i++) {
      const p = this.plotData[i];
      const val = (p && p[valueKey] !== undefined && p[valueKey] !== null) ? p[valueKey] : (p ? p.speed : null);
      if (p && val !== null && !p.isError) {
        const ratio = Math.max(0, Math.min(1, val / yMax));
        points.push({
          x: this._getX(i, marginLeft, plotWidth),
          y: plotBottom - ratio * plotHeight
        });
      } else {
        if (points.length > 0) {
          this._renderLine(ctx, points, strokeColor, fillColor, plotBottom, lineWidth, lineDash);
          points.length = 0;
        }
      }
    }

    if (points.length > 0) {
      this._renderLine(ctx, points, strokeColor, fillColor, plotBottom, lineWidth, lineDash);
    }
  }

  /**
   * 風速プロットの描画（なめらかなライン）
   * - 10分スケール: 単一ライン（従来通り受信生データプロット）
   * - 10分超スケール: 最小値、最大値、中央値の3系列ライン
   * @private
   */
  _drawSpeedPlot(ctx, tSpeed, tSpeedMin, tSpeedMedian, tSpeedMax, marginLeft, plotWidth, plotHeight, plotBottom) {
    if (this.timeScale === '10m') {
      // 従来通り単一ライン
      this._drawSpeedSeries(
        ctx, 'speed', tSpeed.color, null, 1.8, [],
        tSpeed.yMax, marginLeft, plotWidth, plotHeight, plotBottom
      );

      // 最新値ポイントハイライト
      const latest = this.plotData[PLOT_COUNT - 1];
      if (latest && latest.speed !== null && !latest.isError) {
        const lx = this._getX(PLOT_COUNT - 1, marginLeft, plotWidth);
        const ratio = Math.max(0, Math.min(1, latest.speed / tSpeed.yMax));
        const ly = plotBottom - ratio * plotHeight;
        ctx.fillStyle = tSpeed.color;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 10分超スケール: 最小値、最大値、中央値の3系列描画
      // 1. 最小値ライン (ディープブルー・破線)
      this._drawSpeedSeries(
        ctx, 'speedMin', tSpeedMin.color, null, tSpeedMin.lineWidth, tSpeedMin.dash,
        tSpeed.yMax, marginLeft, plotWidth, plotHeight, plotBottom
      );

      // 2. 最大値ライン (スカイブルー・破線)
      this._drawSpeedSeries(
        ctx, 'speedMax', tSpeedMax.color, null, tSpeedMax.lineWidth, tSpeedMax.dash,
        tSpeed.yMax, marginLeft, plotWidth, plotHeight, plotBottom
      );

      // 3. 中央値ライン (シアン・実線)
      this._drawSpeedSeries(
        ctx, 'speedMedian', tSpeedMedian.color, null, tSpeedMedian.lineWidth, tSpeedMedian.dash,
        tSpeed.yMax, marginLeft, plotWidth, plotHeight, plotBottom
      );

      // 最新値ポイントハイライト（中央値・現在値）
      const latest = this.plotData[PLOT_COUNT - 1];
      const val = (latest && latest.speedMedian !== undefined && latest.speedMedian !== null) ? latest.speedMedian : (latest ? latest.speed : null);
      if (latest && val !== null && !latest.isError) {
        const lx = this._getX(PLOT_COUNT - 1, marginLeft, plotWidth);
        const ratio = Math.max(0, Math.min(1, val / tSpeed.yMax));
        const ly = plotBottom - ratio * plotHeight;
        ctx.fillStyle = tSpeedMedian.color;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * 風向プロットの描画（点プロット / 散布図、ラインで繋がない）
   * @private
   */
  _drawDirectionPlot(ctx, tDir, marginLeft, plotWidth, plotHeight, plotBottom) {
    ctx.fillStyle = tDir.color;
    const dotRadius = 1.8;

    for (let i = 0; i < PLOT_COUNT - 1; i++) {
      const p = this.plotData[i];
      if (p && p.direction !== null && !p.isError) {
        const x = this._getX(i, marginLeft, plotWidth);
        const ratio = Math.max(0, Math.min(1, p.direction / 359));
        const y = plotBottom - ratio * plotHeight;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 最新値ポイントハイライト（右端の最新点は常に描画）
    const latest = this.plotData[PLOT_COUNT - 1];
    if (latest && latest.direction !== null && !latest.isError) {
      const lx = this._getX(PLOT_COUNT - 1, marginLeft, plotWidth);
      const ratio = Math.max(0, Math.min(1, latest.direction / 359));
      const ly = plotBottom - ratio * plotHeight;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tDir.color;
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 折れ線と下部塗りつぶし描画
   * @private
   */
  _renderLine(ctx, points, strokeColor, fillColor, bottomY, lineWidth = 1.8, lineDash = []) {
    if (points.length < 2) {
      if (points.length === 1) {
        ctx.fillStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (lineDash && lineDash.length > 0) {
      ctx.setLineDash(lineDash);
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // 半透明塗りつぶし
    if (fillColor) {
      if (lineDash && lineDash.length > 0) {
        ctx.setLineDash([]);
      }
      ctx.lineTo(points[points.length - 1].x, bottomY);
      ctx.lineTo(points[0].x, bottomY);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * 時間軸（横軸）ラベルの描画
   * @private
   */
  _drawTimeAxis(ctx, marginLeft, plotWidth, axisY, topY) {
    const labels = TIME_AXIS_LABELS[this.timeScale] || TIME_AXIS_LABELS['10m'];
    const count = labels.length;
    if (count < 2) return;

    // フォントサイズ: 画面幅が狭い場合（モバイル等）に文字の重なりを防ぐ
    const fontSize = plotWidth < 420 ? 9 : (plotWidth < 540 ? 10 : 11);
    ctx.font = `${fontSize}px sans-serif`;

    // 時間軸ラベルテキストの描画
    for (let i = 0; i < count; i++) {
      const x = marginLeft + (i / (count - 1)) * plotWidth;
      const isLatest = (i === count - 1);

      if (i === 0) {
        ctx.textAlign = 'left';
      } else if (isLatest) {
        ctx.textAlign = 'right';
      } else {
        ctx.textAlign = 'center';
      }

      ctx.fillStyle = isLatest ? '#00f0ff' : '#94a3b8';
      ctx.fillText(labels[i], x, axisY + 18);
    }
  }
}
