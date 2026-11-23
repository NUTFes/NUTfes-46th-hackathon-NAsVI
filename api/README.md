# API / Hub 試作

ルートで `npx -y pnpm@latest install`。Node は mise.toml の 22.22.1。

```sh
npx -y pnpm@latest --filter api migrate
npx -y pnpm@latest --filter api dev
```

どちらもローカルのみ。DB はダミー UUID、認証・デプロイ不要。
`wrangler.jsonc` の ENABLE_DEV_EMIT が文字列 `true` の場合のみ、
`POST /dev/emit` が有効（それ以外は404）。例:

```sh
curl -X POST http://127.0.0.1:8787/dev/emit -H 'Content-Type: application/json' -d '{"type":"stampPressed"}'
curl -N 'http://127.0.0.1:8787/changes?since=0'
npx -y pnpm@latest typecheck
npx -y pnpm@latest test
npx -y pnpm@latest build
npx -y pnpm@latest generate:types
```

型は openapi-typescript で仕様から生成する。schema.d.ts は手編集しない。
6種類の type のみ保存し、payload は仕様に沿うダミー。proof は配らない。
負荷計測専用の任意 `sentAt`（epoch milliseconds）だけを payload に追加する。
不正な body/type は400。実際の場所・スタンプAPIはない。

## 再送の規則

Hub は idFromName('global') の1個。接続をメモリの Set に保持し、
接続準備中の publish は一時キューに入れる。since 指定時だけ1回のSQLで
MIN/MAXと `id > since` の行を同じスナップショットから昇順取得する。
Last-Event-ID が存在すれば since より優先（不正値でもフォールバックしない）。
指定なしなら過去を流さず、接続登録後の publish だけ流す。

非負の安全な整数以外、最大idより大きい値、最小id−1より小さい値、
続きの連番に穴がある場合は、id 行なしの `event: resync` / `data: {}` を送り閉じる。
空のDBの cursor は0とし、since=0だけ有効。最大idと等しければ新規配信待ち。
履歴削除は今回未実装（全履歴保持）。25秒ごとに `: ping`。
stream cancel・書き込み失敗で Set とタイマーを掃除する。

## 負荷試験

上のローカルサーバーを起動した別ターミナルで、リポジトリルートから実行:

```sh
node tools/loadtest/sse.mjs --url http://127.0.0.1:8787 --clients 50 --emits 20 --interval 100 --duration 27000
node tools/loadtest/sse.mjs --url http://127.0.0.1:8787 --clients 200 --emits 20 --interval 100 --duration 27000
```

interval/duration はミリ秒。duration は最後の emit 後の観測時間。
全接続の準備後に順次 emit し、今回返ったidだけを集計する。
JSONで各接続の受信件数・遅延中央値/p95/最大・切断数と、全体の同じ集計、
全員全件受信の成否を出力する。意図的な終了は切断数に含めない。
自動再接続は行わず、欠落・切断時は終了コード1。終了時には全接続をabortする。
終わったらサーバーも Ctrl-C で停止する。

テストは @cloudflare/vitest-pool-workers 0.23.0 / Vitest 4.1系 /
wrangler 4.124.0 を組み合わせ、実際の Workers ランタイムと D1 で検証。
旧名のpoolパッケージは非推奨だが、今回の指定に従い使用。
compatibility_date は同梱 workerd が対応する 2026-08-15 に固定した。

## 試作の制限

- ローカル結果は本番無料プランのDO接続数上限やCPU 10msを再現しない。
- SSE はDOを起こしたまま保持する。リプレイ・配信キューの上限や遅い読者への制御は未実装。
- D1への保存とpublishは別処理。間で失敗した場合は再接続時の履歴再送で回復する。
- 同時 emit の保存順と publish 到着順の逆転は未対処。試験は直列 emit。
  本番化する前に書き込みと配信の直列化・失敗時の再送を設計する必要がある。
- web の resync は一覧API未実装のため現在から開き直すだけ。仕様どおりの
  GET /places・GET /stamps 再取得と小さい方のcursorによる再接続は後続実装。

## ローカル実測

各条件を単独実行。20件を100ms間隔で送り、送信完了後27秒観測。

| 接続数 | 受信総数 | 各接続の受信数 中央値/p95/最大 | 遅延ms 中央値/p95/最大 | 切断 | 全員全件 |
|---|---|---|---|---|---|
| 50 | 1000 | 20 / 20 / 20 | 44 / 96 / 303 | 0 | 成功 |
| 200 | 4000 | 20 / 20 / 20 | 38 / 303 / 317 | 0 | 成功 |

install、web/api型検査、web build、D1マイグレーション、Workersプールの5テストが成功。
開発中の再読み込みで切断した測定は除き、コードを固定した単独実行の値を記載した。
