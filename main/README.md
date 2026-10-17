## かざみんリアルタイムモニター(KZM100A/KZM100LR)

### 概要
パソコン(Windows/Mac/Linux)で動作するブラウザーベースのリアルタイムモニタリングソフトです。同梱のUSBシリアル変換アダプタ経由で結線して使用します。[Web Serial API][1] の仕様制限により、Androidスマートフォン、iPhoneでは動作いたしません。かざみん本体をお持ちでない場合はデモモードで表示機能をお試しいただけます。

### 動作環境
- 対象デバイス: KZM100A/KZM100LR
- 対応OS: Windows / macOS / Linux
- 対応ブラウザ: Chrome / Edge / Firefox /Opera
- ※ブラウザは最新版をご利用ください。
- ※ブラウザはJavaScriptの他に[Web Serial API][1] をサポートしている必要があります。

### 使用方法
- かざみん本体と同梱のUSBシリアルアダプターで接続
-「接続」ボタンから対象のシリアルポートを選択するとかざみんと接続され、グラフ表示と受信ログの表示が開始されます。
- 「過去24h CSV出力」を選択すると、ログがCSVフォーマットでダウンロードできます。
- 風速のスケールは 5[m/s],10[m/s],20[m/s],30[m/s] から選択できます。
- 時間のスケールは10分間,1時間,6時間,24時間,7日間から選択できます。
- 気温のスケールは「-10～+50℃」、「-20～+65℃」のいずれかを選択できます。
### 注意事項
- かざみん本体の設定は工場出荷時状態に限定いたします。出力インターバルは1[s]、単位は[m/s]でご利用ください。
- 仕様は予告なく変更になる場合がございます。バグ等ございましたらご連絡ください。
- 提供しておりますソフトウェアは全てサポート対象外となります。

### ライセンス
- **プログラムコード**: [MIT License](LICENSE) のもとで公開されています。
- **アイコン・ロゴ素材**: `icons/` 配下のSVGファイルおよびロゴ等のグラフィック素材は **商用利用禁止（All Rights Reserved）** です。詳細は [LICENSE](LICENSE) をご確認ください。

------------------------------------------
## Kazamin Real-Time Monitor (KZM100A/KZM100LR)

### Overview

A browser-based real-time monitoring software that runs on PCs (Windows / macOS / Linux). It connects via the included USB-to-serial adapter. Due to technical limitations of the [Web Serial API][1]
this software does not work on Android smartphones or iPhones. If you do not own a Kazamin unit, you can test the display functions using Demo Mode.

### System Requirements

* **Compatible Devices:** KZM100A / KZM100LR
* **Supported OS:** Windows / macOS / Linux
* **Supported Browsers:** Chrome / Edge / Firefox / Opera
* *Please use the latest version of your browser.*
* *The browser must support JavaScript as well as the [Web Serial API][1].*

### How to Use

* Connect the Kazamin unit using the included USB-to-serial adapter.
* Click the **"Connect"** button and select the appropriate serial port. Once connected, graph visualization and received log display will begin automatically.
* Selecting **"Past 24h CSV Export"** allows you to download the log data in CSV format.
* Wind speed scales can be selected from: 5 m/s, 10 m/s, 20 m/s, or 30 m/s.
* Time scales can be selected from: 10 minutes, 1 hour, 6 hours, 24 hours, or 7 days.
* Temperature scales can be selected from either "-10 to +50°C" or "-20 to +65°C".

### Notes & Disclaimers

* The Kazamin unit must remain in its factory default settings. Please ensure the output interval is set to 1 s and the unit is set to m/s.
* Specifications are subject to change without prior notice. If you encounter any bugs or issues, please contact us.
* All provided software is offered without official technical support.

### License

- **Source Code:** Released under the [MIT License](LICENSE).
- **Icons & Logos:** The SVG graphics in `icons/` and logo assets are **strictly excluded from the MIT License (Commercial Use Prohibited / All Rights Reserved)**. See [LICENSE](LICENSE) for details.

[1]:https://developer.mozilla.org/ja/docs/Web/API/Web_Serial_API
