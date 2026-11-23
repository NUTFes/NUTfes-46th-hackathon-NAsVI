# web

Vue 3 + Vite + TypeScript の受信確認画面。

```sh
# リポジトリルート
npx -y pnpm@latest install
npx -y pnpm@latest --filter web dev
npx -y pnpm@latest --filter web typecheck
npx -y pnpm@latest --filter web build
```

api/README.md の手順で API を localhost:8787 に起動してから、
Vite の表示するURLを開く。`/changes` は Vite proxy 経由。
POST /dev/emit を実行すると6種類の出来事を直近200件まで表示する。
通常の切断は EventSource が Last-Event-ID 付きで自動再接続する。
resync では古い EventSource を閉じて受信一覧を消し、現在から接続を作り直す。
場所・スタンプの一覧APIは未実装なので、仕様の一覧再取得・新cursorでの
接続は未対応（後続実装が必要）。初回も過去の履歴は要求しない。
開発用 proxy はビルド成果物には含まれない。
