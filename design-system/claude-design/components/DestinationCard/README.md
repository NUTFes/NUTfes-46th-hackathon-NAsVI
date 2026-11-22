# DestinationCard

行き先への方角・距離・更新時刻を見せ、着いたら知らせる。

- 使う画面: guide(V1-e・V1-n)
- 見せるもの: Destination(方角・残りの距離・更新時刻)、Position(精度)、Place(名前・建物と階)
- 状態: 下書き(チームで確認する前)。※ の付いた所は、概念設計の変更待ち

## 作り

1. 方角の矢印(黄の四角の中)。着いたらチェック
2. 上の小さい字: 「案内中・総合研究棟 2階」/「行き先に着きました」
3. 名前
4. 更新時刻と精度
5. 距離と方角の文字
6. 操作: カメラで見る・案内をやめる / 建物の中の地図・案内を終える

## 渡すもの(props)

| 名前 | 型 | 必須 | 既定値 | 取りうる値 / 説明 | API の項目 |
|---|---|---|---|---|---|
| state | 列挙 | ○ | guiding | guiding / arrived | なし |
| placeName・building・floor | 文字列 | ○ | — | 名前は 2 行まで。超えるときは末尾を「…」にする(apply-log ⑤) | places |
| headingDeg | 数 | ○ | — | 端末の向きからの角度 | なし(端末で計算。D-003) |
| remainingM | 数 | ○ | — | 直線距離 | なし(端末で計算) |
| updatedAt | 時刻 | ○ | — | 「10 秒前に更新」 | なし(端末) |
| accuracyM | 数 | | なし | 「精度 ±8 m」 | なし(端末) |
| onCamera・onStop・onFinish・onBuildingMap | 関数 | ○ | — | onStop・onFinish は Destination.clear ※ | なし |

Design System で足した props: directionLabel・note・arriveWithinM(仕様には無い。`components/index.d.ts` に【Design System で追加】と書いた)

## 状態

| 状態 | 見た目・振る舞い | 使うトークン |
|---|---|---|
| 通常(案内中) | 黄の枠 | destination、destination-on、bg-surface |
| 着いた | チェックと「着きました」 | 同上 |
| 古い | 更新が 30 秒以上ないとき、時刻を目立たせる(原則 P2) | stale |
| 押下・無効・空 | なし | |
| エラー | 位置が使えなくなったら Banner に切り替える | |

## 使う / 使わない

- 使う: 行き先を決めたあと、地図の下
- 使わない: カメラの上では DestinationBar

## アクセシビリティ

- 読み上げの文言: aria-live="polite"。距離が大きく変わったときだけ読む
- 色だけに頼っていないか: 方角は矢印と文字(「北」)

## 未確認・要確認

- 着いたとみなす距離(20 m で仮置き。新しい OQ の候補)
- 「古い」とみなす時間(原則 P2。未定)
- 案内をやめる同期が概念設計に無い(※)
