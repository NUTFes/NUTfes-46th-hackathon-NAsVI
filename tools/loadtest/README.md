# SSE 負荷試験

Node.js 22 の標準 API だけを使う。依存の追加は不要。リポジトリルートから実行する。
既存の `--url --clients --emits --interval --duration` は引き続き使える。

## ローカルで 50・200 接続を再現

ワークスペースの依存を準備済みの環境で、ローカル D1 を初期化し、API を起動する。
`api` の `dev` は `wrangler dev --local`、`migrate` はローカル D1 への適用である。

```sh
corepack pnpm --filter api migrate
corepack pnpm --filter api dev
```

別ターミナルで次を**順番に**実行する。開発サーバーの再読み込みが入ると切断として記録されるため、試験中は API を編集しない。

```sh
node tools/loadtest/sse.mjs --url http://127.0.0.1:8787 --clients 50 --ramp-step 50 --emits 20 --interval 100 --duration 27000 --out /tmp/sse-50.json
node tools/loadtest/sse.mjs --url http://127.0.0.1:8787 --clients 200 --ramp-step 200 --emits 20 --interval 100 --duration 27000 --out /tmp/sse-200.json
```

確認値は順に `receivedTotal: 1000` / `4000`、`received` の median・p95・max がすべて `20`、
`disconnects: 0`、`failures: 0`、`emitFailures: 0`、`allReceived: true`。
遅延は実行環境によって変わり、`api/README.md` の実測値との一致は合否条件にしない。
終了後は API を Ctrl-C で停止する。

## 段階的に接続を増やす

```sh
node tools/loadtest/sse.mjs --url http://127.0.0.1:8787 --clients 700 --ramp-step 50 --ramp-interval 1000 --emits 120 --interval 1000 --duration 30000 --out /tmp/sse-ramp.json
```

最初に 50 接続、その後 1000 ms の待機を挟んで次の 50 接続を開始し、700 接続まで増やす。
先行段階の接続準備を待たず次の段階を開始する。最後の段階は残数だけを接続する。
全接続の準備成功または失敗が確定してから、emit を直列に開始する。
したがって ramp 中の配信は測らず、接続数を増やした後の配信を測る。
700 接続は目安の上限 600 を超える比較条件であり、成功を保証する数値ではない。

| 引数 | 既定値 | 意味 |
| --- | --- | --- |
| `--url` | `http://127.0.0.1:8787` | API の origin。パス指定は従来どおり無視し、`/changes` と `/dev/emit` を使う |
| `--clients` | `50` | 接続を試みる総数。1〜1000(定数 `MAX_CLIENTS`)。超える指定は断る |
| `--emits` | `20` | emit の試行数。正の整数 |
| `--interval` | `100` | emit の応答後、次の emit までの待機時間(ms)。0 可 |
| `--duration` | `5000` | 最後の emit の応答後の観測時間(ms)。正の整数。全件受信しても短縮しない |
| `--ramp-step` | clients の 10%(切り上げ、最小 1) | 1 段階で開始する接続数。一斉接続にしたいときだけ clients と同じ値を明示する |
| `--ramp-interval` | `1000` | 段階間の待機時間(ms)。0 可。接続処理の開始にかかる時間は別途加わる |
| `--timeout` | `15000` | 各接続の最初の SSE chunk まで、および各 emit の応答本文までの制限時間(ms) |
| `--out` | なし | 標準出力と同じ JSON を保存するファイル。親ディレクトリは事前に作成する。既存ファイルは上書き |
| `--allow-remote` | 無効 | 向け先が `127.0.0.1`・`localhost`・`[::1]` 以外のとき必須。無ければ終了コード 1 で断る。値は付けない |
| `--verbose` | 無効 | `clients` にクライアント別の詳細を追加する。値は付けない |

時間の引数は整数で、Node のタイマー上限 `2147483647` ms 以下。
自動再接続はしない。接続エラー、非 2xx、SSE でない応答、準備中の切断、タイムアウトは
`failures` と `disconnects` に各 1 件を加え、残りの接続・emit・JSON 出力を続行する。
接続成功後の EOF・読み取りエラーも `disconnects` に各 1 件を加える。
終了時の意図的な abort は切断に含めない。リダイレクトは追跡せず失敗扱いにする。
emit は HTTP 201 と一意な正の整数 `id` が必要で、それ以外や通信エラーは `emitFailures` に加えて次へ進む。
失敗した emit がサーバーでは保存・配信済みの場合もあるが、成功応答の id だけを受信集計に使う。

### 安全策

- 向け先がローカル以外のときは `--allow-remote` が必須。自分の管理する試験デプロイにだけ使う。
- 非ローカルでは、1 秒あたりの新規接続数 `ramp-step × 1000 ÷ ramp-interval` が 100(定数 `MAX_CONNECTS_PER_SECOND`)を超える指定、`--ramp-interval 0` を断る。ローカルには適用しない。
- 結果 JSON の `options.url` は、ローカルなら origin、ローカル以外ならホスト名を伏せた `https://<remote-host-hidden>` を出す。
- `--out` が `/tmp`(または OS の一時ディレクトリ)の外のとき、標準エラーに警告する。本番由来の結果をリポジトリにコミットしない。

### 受信の集計の仕様

CLI が送った emit(payload の `sentAt` が自分の送信時刻と一致し、emit の応答 `id` が成功したもの)だけを数える。
他者や他の経路の変更が同じ `/changes` に流れても、受信数・遅延・`missing`・`orderViolations` には含めない。
したがって他者の emit が混じる環境でも、自分の emit の件数だけを評価できる。

終了コードは正常なら 0、受信不足・切断・接続失敗・emit 失敗・`missing`・`orderViolations` があれば 1。
実行中の通信失敗でも JSON を出す。引数の不正やファイル保存失敗は標準エラーへ出し、終了コード 1 とする。

## 本番相当の試験デプロイ後

このツールはデプロイや認証設定を行わない。別途用意した**負荷試験用のデプロイ**に対して実行する。
以下の URL は予約ドメインによる仮の値であり、そのままでは利用できない。

`api/src/routes/dev.ts` の実装では、`ENABLE_DEV_EMIT` が文字列 `'true'` の場合だけ `/dev/emit` が使える。
それ以外は 404 であり、通常の本番設定で利用できるとは限らない。
現在の `api/wrangler.jsonc` には `'true'` があるが、試験先の実際の環境設定を確認する必要がある。
`api/src/app.ts` は `/api/changes`・`/api/dev/emit` に加え、互換用の `/changes`・`/dev/emit` も公開している。
この CLI はその互換経路を使う。

`/dev/emit` はダミーの変更を D1 の `changes` に保存し、Hub に配信する。
試験先でこの経路を有効にし、認証ヘッダーなしで到達できることが前提。
CLI にトークンを渡す機能はない。試験用のデータを使用し、試験後はこの経路を無効にする。
無効な場合の 404 は `emitFailures` になり、受信遅延の測定は成立しない。

```sh
# 400、600、700 接続をそれぞれ別々に実行し、条件ごとに保存する
node tools/loadtest/sse.mjs --allow-remote --url https://sse-trial.example.invalid --clients 400 --ramp-step 50 --ramp-interval 1000 --emits 120 --interval 1000 --duration 30000 --out /tmp/sse-trial-400.json
node tools/loadtest/sse.mjs --allow-remote --url https://sse-trial.example.invalid --clients 600 --ramp-step 50 --ramp-interval 1000 --emits 120 --interval 1000 --duration 30000 --out /tmp/sse-trial-600.json
node tools/loadtest/sse.mjs --allow-remote --url https://sse-trial.example.invalid --clients 700 --ramp-step 50 --ramp-interval 1000 --emits 120 --interval 1000 --duration 30000 --out /tmp/sse-trial-700.json
```

Hub の接続数・CPU・D1 応答時間はデプロイ側で別途観測する。この CLI は受信側の数値のみを測る。
ローカル試験は本番の接続上限・CPU・無料枠を再現しない。

## 出力 JSON の形

既定のキー一覧は次の例のとおり。`options` は解決済みの引数、`rampStages` は段階ごとの結果である。
テストはこの例と実際の JSON のキーをネストも含めて比較する。

<!-- report-example -->
```json
{
  "options": {
    "url": "http://127.0.0.1:8787",
    "clients": 50,
    "emits": 20,
    "interval": 100,
    "duration": 27000,
    "rampStep": 50,
    "rampInterval": 1000,
    "timeout": 15000,
    "out": null,
    "verbose": false,
    "allowRemote": false
  },
  "emitted": 20,
  "emitAttempts": 20,
  "emitFailures": 0,
  "connected": 50,
  "failures": 0,
  "receivedTotal": 1000,
  "received": { "median": 20, "p95": 20, "max": 20 },
  "latencyMs": { "median": 5, "p95": 12, "max": 25 },
  "disconnects": 0,
  "missing": 0,
  "orderViolations": 0,
  "allReceived": true,
  "rampStages": [
    { "stage": 1, "startedAtMs": 0, "attempted": 50, "connected": 50, "failures": 0 }
  ]
}
```

| キー | 意味 |
| --- | --- |
| `emitted` | 成功応答の一意な id の数 |
| `emitAttempts` / `emitFailures` | emit の試行数 / 失敗数 |
| `connected` / `failures` | 接続準備の成功数 / 失敗数。接続後に切断しても connected は減らない |
| `receivedTotal` | 全クライアントの今回の id の受信数の合計。同じクライアントによる同じ id の重複は除く |
| `received` | クライアントごとの受信数の median・p95・max。接続失敗したクライアントも 0 件として含む |
| `latencyMs` | 今回の id を受信した時刻 − payload.sentAt (epoch ms) の median・p95・max。受信サンプルがなければ各値 null |
| `disconnects` | 接続失敗を含む、意図しない切断の合計。再接続しないので各クライアント最大 1 件 |
| `missing` | 接続できたクライアントが受け取れなかった、今回の emit の件数の合計(取りこぼし) |
| `orderViolations` | クライアントが、すでに受け取った id より小さい id を後から受け取った件数の合計(順序の逆転) |
| `allReceived` | 全接続の準備が成功し、指定した全 emit が成功し、全クライアントが全件受信したか。受信後の切断の有無は disconnects で別途確認 |
| `rampStages` | stage は 1 始まり。startedAtMs は試験開始からその段階の接続開始までの実測 ms。attempted・connected・failures はその段階のみの数であり累積ではない |

分位点は昇順の `ceil(件数 × p)` 番目(1 始まり)。遅延は送受信機の時計が同期していることが前提で、
ネットワークだけでなくサーバー処理やクライアント処理の時間も含む。

`--verbose` の場合のみ、上のトップレベルに `clients` 配列を追加する。各要素のキー一覧は次の例のとおり。
`client` は 1 始まり、`error` は通信・解析失敗時の文字列(正常なら null)。

<!-- client-example -->
```json
{
  "client": 1,
  "connected": true,
  "received": 20,
  "latencyMs": { "median": 5, "p95": 12, "max": 25 },
  "disconnects": 0,
  "missing": 0,
  "orderViolations": 0,
  "error": null
}
```

## テスト

```sh
node --test tools/loadtest/test/*.test.mjs
```

`node:test` とローカル HTTP サーバーだけを使う。`127.0.0.1` の空きポートで `/changes` と `/dev/emit` を実装し、
50・200 クライアントそれぞれに 20 件を配信して全件受信・切断 0 を確認する。
テストでは待機時間を短縮する。ramp、失敗の集計、CLI の保存と終了コード、README のキー一覧も検査する。
外部 API やデプロイ先へは通信しない。sandbox で listen が EPERM になる場合、この環境では HTTP を使うテストは実行できない。
