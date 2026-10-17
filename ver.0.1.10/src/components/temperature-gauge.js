/**
 * temperature-gauge.js
 * リアルタイム丸形温度計コンポーネント
 *
 * 仕様:
 * - 丸形メーター（ダイアル型）デザイン
 * - 0℃（氷点）と 25℃（適温）の位置がひと目でわかるハイライト表示
 * - 時間軸グラフと連動した温度スケール切替（-10〜+50℃ / -20〜+65℃）
 * - なめらかな針・アークアニメーション
 */

export class TemperatureGauge {
  /**
   * @param {HTMLElement} containerElement
   * @param {string} [initialScale='default'] - 'default' (-10〜+50℃) または 'max' (-20〜+65℃)
   */
  constructor(containerElement, initialScale = 'default') {
    this.container = containerElement;
    this.scaleKey = initialScale;
    this.minTemp = initialScale === 'max' ? -20 : -10;
    this.maxTemp = initialScale === 'max' ? 65 : 50;
    this.currentTempC = null;
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="gauge-card temperature-card">
        <div class="gauge-header">
          <span class="gauge-title">気温 (TEMPERATURE)</span>
        </div>
        <div class="gauge-body">
          <svg class="temp-svg" viewBox="0 0 300 240" width="100%" height="100%">
            <defs>
              <!-- 温度バーの4セグメント固定グラデーション（低温青〜水色〜適温緑〜黄〜赤） -->
              <linearGradient id="tempGrad1" x1="63" y1="210" x2="63" y2="110" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#0284c7" />
                <stop offset="100%" stop-color="#38bdf8" />
              </linearGradient>
              <linearGradient id="tempGrad2" x1="63" y1="110" x2="150" y2="60" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#38bdf8" />
                <stop offset="100%" stop-color="#22c55e" />
              </linearGradient>
              <linearGradient id="tempGrad3" x1="150" y1="60" x2="237" y2="110" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#22c55e" />
                <stop offset="100%" stop-color="#eab308" />
              </linearGradient>
              <linearGradient id="tempGrad4" x1="237" y1="110" x2="237" y2="210" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#eab308" />
                <stop offset="100%" stop-color="#ef4444" />
              </linearGradient>

              <!-- マスク: 針先端までの円弧のみを表示 -->
              <mask id="tempArcMask">
                <path id="temp-mask-arc" class="temp-arc-mask" />
              </mask>
            </defs>

            <!-- 背景アークトラック (開始 -210度, 終了 30度 = 240度の円弧) -->
            <path id="temp-track-bg" class="temp-arc-track" />

            <!-- プログレスバー（固定グラデーション + マスク制御） -->
            <g id="temp-track-fill-group" mask="url(#tempArcMask)" style="opacity: 0; transition: opacity 0.2s ease;">
              <path id="temp-seg-1" class="temp-arc-seg" stroke="url(#tempGrad1)" />
              <path id="temp-seg-2" class="temp-arc-seg" stroke="url(#tempGrad2)" />
              <path id="temp-seg-3" class="temp-arc-seg" stroke="url(#tempGrad3)" />
              <path id="temp-seg-4" class="temp-arc-seg" stroke="url(#tempGrad4)" />
            </g>

            <!-- 目盛り線と数値ラベル・ハイライト標識 -->
            <g id="temp-ticks"></g>

            <!-- 針 -->
            <g id="temp-needle-group" style="transform-origin: 150px 160px; transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);">
              <polygon points="146,160 154,160 151,56 149,56" fill="#ffffff" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.5))"/>
              <circle cx="150" cy="160" r="8" fill="#1e293b" stroke="#38bdf8" stroke-width="2.5" />
            </g>

            <!-- スケール表示 -->
            <text x="150" y="202" class="temp-scale-indicator" id="temp-scale-text">SCALE: -10 ~ +50 ℃</text>
          </svg>
        </div>

        <div class="gauge-footer">
          <div class="gauge-value-display">
            <span class="value-number" id="temp-c-text">--.-</span>
            <span class="value-unit">℃</span>
          </div>
        </div>
      </div>
    `;

    this.trackBg = this.container.querySelector('#temp-track-bg');
    this.maskArc = this.container.querySelector('#temp-mask-arc');
    this.fillGroup = this.container.querySelector('#temp-track-fill-group');
    this.seg1 = this.container.querySelector('#temp-seg-1');
    this.seg2 = this.container.querySelector('#temp-seg-2');
    this.seg3 = this.container.querySelector('#temp-seg-3');
    this.seg4 = this.container.querySelector('#temp-seg-4');
    this.ticksGroup = this.container.querySelector('#temp-ticks');
    this.needleGroup = this.container.querySelector('#temp-needle-group');
    this.scaleText = this.container.querySelector('#temp-scale-text');
    this.cText = this.container.querySelector('#temp-c-text');

    this._setupArc();
    this._drawTicks();
  }

  /**
   * 極座標から直交座標への変換
   * @private
   */
  _polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad)
    };
  }

  /**
   * 円弧パス文字列生成
   * @private
   */
  _describeArc(cx, cy, r, startAngle, endAngle) {
    const start = this._polarToCartesian(cx, cy, r, startAngle);
    const end = this._polarToCartesian(cx, cy, r, endAngle);
    const arcSweep = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${arcSweep} 1 ${end.x} ${end.y}`;
  }

  _setupArc() {
    const fullArc = this._describeArc(150, 160, 100, -210, 30);
    this.trackBg.setAttribute('d', fullArc);

    // 4セグメント（各60度）のパスを設定してグラデーションを全域固定
    this.seg1.setAttribute('d', this._describeArc(150, 160, 100, -210, -150));
    this.seg2.setAttribute('d', this._describeArc(150, 160, 100, -150, -90));
    this.seg3.setAttribute('d', this._describeArc(150, 160, 100, -90, -30));
    this.seg4.setAttribute('d', this._describeArc(150, 160, 100, -30, 30));

    // マスク円弧の初期設定
    this.maskArc.setAttribute('d', fullArc);
    this.arcLength = (this.maskArc.getTotalLength && this.maskArc.getTotalLength()) || 418.88;
    this.maskArc.style.strokeDasharray = `${this.arcLength} ${this.arcLength}`;
    this.maskArc.style.strokeDashoffset = `${this.arcLength}`;
  }

  /**
   * 温度（℃）から角度（-210°〜+30°）を算出
   * @private
   */
  _tempToAngle(temp) {
    const ratio = (temp - this.minTemp) / (this.maxTemp - this.minTemp);
    return -210 + ratio * 240;
  }

  /**
   * 目盛り線、数値、0℃/25℃ハイライトを描画
   * @private
   */
  _drawTicks() {
    const cx = 150;
    const cy = 160;
    const rOuter = 118;
    const rInnerMajor = 108;
    const rOuterMinor = 114;
    const rText = 132;

    let html = '';

    // 目盛りの刻み定義
    // default: -10〜+50 (10刻み: -10, 0, 10, 20, 30, 40, 50, および 25)
    // max: -20〜+65 (10刻み: -20, -10, 0, 10, 20, 30, 40, 50, 60, 65, および 25)
    const tickValues = [];
    const min = this.minTemp;
    const max = this.maxTemp;

    for (let t = Math.ceil(min / 10) * 10; t <= max; t += 10) {
      tickValues.push(t);
    }
    if (max % 10 !== 0 && !tickValues.includes(max)) {
      tickValues.push(max);
    }
    if (min % 10 !== 0 && !tickValues.includes(min)) {
      tickValues.unshift(min);
    }

    // 5刻みの小目盛り
    const minorValues = [];
    for (let t = Math.ceil(min / 5) * 5; t <= max; t += 5) {
      if (!tickValues.includes(t) && t !== 25) {
        minorValues.push(t);
      }
    }

    // 小目盛りの描画
    minorValues.forEach((val) => {
      const angle = this._tempToAngle(val);
      const pOuter = this._polarToCartesian(cx, cy, rOuterMinor, angle);
      const pInner = this._polarToCartesian(cx, cy, rInnerMajor, angle);
      html += `<line x1="${pOuter.x.toFixed(1)}" y1="${pOuter.y.toFixed(1)}" x2="${pInner.x.toFixed(1)}" y2="${pInner.y.toFixed(1)}" stroke="#475569" stroke-width="1.2" />`;
    });

    // 主目盛りと数値の描画
    tickValues.forEach((val) => {
      const angle = this._tempToAngle(val);
      const isFreeze = val === 0;
      const strokeColor = isFreeze ? '#00f0ff' : '#64748b';
      const strokeW = isFreeze ? '3' : '2';
      const textColor = isFreeze ? '#00f0ff' : 'var(--text-secondary)';
      const fontWeight = isFreeze ? '800' : '600';

      // 0℃は円の内側まで突き抜ける形状（r=86〜120）
      const pOuter = this._polarToCartesian(cx, cy, isFreeze ? 120 : rOuter, angle);
      const pInner = this._polarToCartesian(cx, cy, isFreeze ? 86 : rInnerMajor, angle);
      const pText = this._polarToCartesian(cx, cy, rText, angle);

      html += `<line x1="${pOuter.x.toFixed(1)}" y1="${pOuter.y.toFixed(1)}" x2="${pInner.x.toFixed(1)}" y2="${pInner.y.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeW}" ${isFreeze ? 'stroke-linecap="round"' : ''} />`;
      html += `<text x="${pText.x.toFixed(1)}" y="${(pText.y + 4).toFixed(1)}" text-anchor="middle" dominant-baseline="central" class="temp-tick-text" style="fill: ${textColor}; font-weight: ${fontWeight};">${val}</text>`;
    });

    // 25℃（適温）の特別目盛り: 円の内側まで突き抜ける形状（r=86〜120）
    if (min <= 25 && 25 <= max) {
      const angle25 = this._tempToAngle(25);
      const pOuter25 = this._polarToCartesian(cx, cy, 120, angle25);
      const pInner25 = this._polarToCartesian(cx, cy, 86, angle25);
      const pText25 = this._polarToCartesian(cx, cy, rText, angle25);

      html += `<line x1="${pOuter25.x.toFixed(1)}" y1="${pOuter25.y.toFixed(1)}" x2="${pInner25.x.toFixed(1)}" y2="${pInner25.y.toFixed(1)}" stroke="#22c55e" stroke-width="3" stroke-linecap="round" />`;
      html += `<text x="${pText25.x.toFixed(1)}" y="${(pText25.y + 4).toFixed(1)}" text-anchor="middle" dominant-baseline="central" class="temp-tick-text" style="fill: #22c55e; font-weight: 800;">25</text>`;
    }

    this.ticksGroup.innerHTML = html;
    if (this.scaleText) {
      const signMin = this.minTemp >= 0 ? '+' : '';
      const signMax = this.maxTemp >= 0 ? '+' : '';
      this.scaleText.textContent = `SCALE: ${signMin}${this.minTemp} ~ ${signMax}${this.maxTemp} ℃`;
    }
  }

  /**
   * 温度スケール（'default': -10〜+50℃ / 'max': -20〜+65℃）を変更
   * @param {string} scaleKey
   */
  setScale(scaleKey) {
    if (scaleKey === 'max') {
      this.minTemp = -20;
      this.maxTemp = 65;
      this.scaleKey = 'max';
    } else {
      this.minTemp = -10;
      this.maxTemp = 50;
      this.scaleKey = 'default';
    }
    this._drawTicks();
    this._updateVisuals();
  }

  /**
   * 温度データを更新
   * @param {object} packet
   */
  update(packet) {
    if (!packet || !packet.isValid) return;

    this.currentTempC = packet.temperature;
    this._updateVisuals();
  }

  /**
   * 表示（針・アーク・数値）を更新
   * @private
   */
  _updateVisuals() {
    if (this.currentTempC === null || this.currentTempC === undefined) return;

    const sign = this.currentTempC >= 0 ? '+' : '';

    if (this.cText) {
      this.cText.textContent = `${sign}${this.currentTempC.toFixed(1)}`;
    }

    // スケール内の比率 (0.0 〜 1.0)
    const ratio = Math.max(0, Math.min(1.0, (this.currentTempC - this.minTemp) / (this.maxTemp - this.minTemp)));
    const startAngle = -210;
    const currentAngle = startAngle + ratio * 240;

    // マスクによって針先端まで固定グラデーションを表示
    if (this.maskArc && this.fillGroup) {
      if (ratio > 0.005) {
        const offset = this.arcLength * (1 - ratio);
        this.maskArc.style.strokeDashoffset = `${offset}`;
        this.fillGroup.style.opacity = '1';
      } else {
        this.maskArc.style.strokeDashoffset = `${this.arcLength}`;
        this.fillGroup.style.opacity = '0';
      }
    }

    // 針の回転 (針初期位置は上(0度)、currentAngle + 90度で回転)
    if (this.needleGroup) {
      const needleDeg = currentAngle + 90;
      this.needleGroup.style.transform = `rotate(${needleDeg}deg)`;
    }
  }
}
