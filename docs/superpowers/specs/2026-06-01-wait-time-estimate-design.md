# 待ち時間予測機能 設計

作成日: 2026-06-01

## 目的

整理券アプリに「予想待ち時間」を追加する。お客様が「あとどれくらい待つか」を把握でき、スタッフも列の進み具合を判断できるようにする。既に記録済みの発券時刻（issuedAt）・案内時刻（calledAt）を活用し、サーバーや外部ライブラリは追加しない。

## 方針

- 既存の単体HTMLファイル構成を維持する（queue.js + index.html）。
- 予測ロジックは queue.js に純粋関数として追加する（DOM・localStorage に触れない）。
- 表示は index.html で行い、storage イベント連動の既存仕組みに乗せる。
- 既存の localStorage データモデル・CSV出力には変更を加えない（読み取り専用の集計関数を足すだけ）。

## 予測ロジック

処理ペース（1組あたりの平均処理時間）× 待ち人数 で予想する。

### averageServeInterval(state, sampleSize = 5)

- 案内済み（`calledAt !== null`）のチケットを集め、`calledAt` を昇順に並べる。
- 連続する `calledAt` の差（間隔）を計算する。
- 直近 `sampleSize` 件（既定5件）の間隔の平均（ミリ秒）を返す。
- 間隔が1件も取れない（案内が1件以下）場合は `null` を返す＝「計測中」。

### estimatedWaitMs(state, number, sampleSize = 5)

- `averageServeInterval` が `null` のときは `null` を返す。
- 対象番号より前にいる待機組数 `ahead`（status==='waiting' かつ number が小さいもの）を数える。
- `interval × (ahead + 1)` を返す。`+1` は現在処理中の組の分。

### estimatedWaitMsForNew(state, sampleSize = 5)

- `averageServeInterval` が `null` のときは `null` を返す。
- 現在の待機組数 `waitingCount` を数える。
- `interval × (waitingCount + 1)` を返す。発券直後と店頭ディスプレイ用。

いずれもミリ秒を返し、表示側で「約N分」に丸める（`Math.round(ms / 60000)`、最低1分）。

## 表示（index.html）

### 受付画面（お客様用）

- 発券直後の番号表示の下に「あと約 N 分 / Approx. N min wait」をバイリンガルで追加表示する。
- `estimatedWaitMsForNew` が `null` のときは「待ち時間 計測中 / Calculating」と表示する。

### 呼び出し表示画面（店頭ディスプレイ用）

- 「目安待ち時間 / Estimated wait: 約 N 分」のボックスを追加する。
- 値は `estimatedWaitMsForNew(state)`。storage イベントで自動更新する。
- `null` のときは「計測中 / Calculating」。

### 呼び出し管理画面（スタッフ用）

- 待機リストの各番号の横に「(予想 約N分)」を表示する（`estimatedWaitMs(state, number)`）。
- `null` のときは「(計測中)」。

## エラー・端の処理

- 案内実績が不足（間隔0件）のときは、全画面で数値を出さず「計測中 / Calculating」と表示する。
- 予測関数は読み取り専用で、state を変更しない。
- 既存データの移行は不要（新しいフィールドを追加しないため）。

## テスト（queue.test.html）

- `averageServeInterval`: 案内が無い／1件のみ→`null`。複数案内→固定時刻で平均が正しい。
- `estimatedWaitMs`: 案内実績なし→`null`。待機位置が後ろほど予想が長い。
- `estimatedWaitMsForNew`: 待機組数に応じて計算される。
- 予測関数が元の state を変更しないこと。

## MVPに含めないもの（将来の拡張）

- 時間帯別の処理ペース補正（昼ピーク等）。
- 人数（partySize）による重み付け。
- スマホ通知・QRコード連携。
