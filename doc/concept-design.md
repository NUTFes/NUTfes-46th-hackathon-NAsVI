# NAsVI の概念設計(ジャクソンの形)

作成: 2026-11-17 / 更新: 2026-11-19(コメント反映。変更履歴は 9 章) / 状態: draft(作成者の案。チームの合意前)

## 0. この文書について

**やったこと。** `concept-design-deductive.md`(道具のリポジトリ naoto-anzai/concept-design の docs/)(以下「演繹文書」)の規則に従って、ハッカソンの内容から概念設計を組み直した。

**材料。** `concept-design/examples/hackathon/` の `input.yaml`(機能 F1〜F4)、`concepts.yaml`(前の案)、`decisions.yaml`、`open-questions.yaml`、`criteria.yaml`、`docs/board-p1.webp`(概念設計ボード)。
これらは材料であり、規則の根拠ではない。規則は演繹文書だけに拠る(章番号は演繹文書の章)。

**前の案との関係。** 前の案(`concepts.yaml`)は、演繹文書の規則で点検すると直す所があった。変更点は 7 章にまとめた。

**記号。** 【推論】は作成者の判断で、ジャクソンの資料では確認できていない。【未決】はチームが決めること(`open-questions.yaml` の OQ-n)。

## 1. 入力: 機能(価値の単位)

`input.yaml` は draft(ボードの画像から起こした値を含む。★要確認)。この文書は、その F1〜F4 をそのまま使う。

| ID | 機能 | 価値 |
|---|---|---|
| F1 | 行きたい場所を見つける | 目当ての企画や出店を、名前の一部から探し出せる |
| F2 | 行き先へ向かう | 現在地と行き先の位置関係をつかんで、迷わず向かえる |
| F3 | 混雑・感想を知る | 足元に押されたスタンプ(混雑 1〜5、面白い、美味しい、よさ など)から、混んでいる場所や良い場所を知って、行く先や時間を選べる |
| F4 | 種類・自分用タグから選ぶ(任意) | 行き先が決まっていない人が、種類や自分用のタグ(お気に入り・行きたい)から場所を選べる。タグで絞ると、地図に出る点も絞られる |
| F5 | 迷いを解く | 今いる建物が分かり、その建物に企画が無いことも含めて、迷っているかを判断できる |

## 2. 概念を分ける(特定性・完全性・独立性。1、12 章)

機能を目的ごとに分けた。目的 1 つに概念 1 つ(12 章)。

| 概念 | 目的(1 文) | 目的の点検(4 章: 必要に焦点・特定的・評価できる) |
|---|---|---|
| Place | 来場者が、会場にどんな場所があるかを知る | 「登録した場所を、来場者が全件見られるか」で測れる |
| Search | 来場者が、名前の一部から目当ての項目を見つける | 「入れた語を含む項目が出て、含まない項目が出ない」で測れる |
| Labeling | 来場者が、項目を種類や自分用のタグで絞って選べる | 「種類か自分用タグを選ぶと、それが付いた項目だけが出る」で測れる |
| Position | 来場者が、自分がいま会場のどこにいるかを知る | 「現在地が、いつの情報かと共に分かる」で測れる |
| Destination | 来場者が、向かう先を 1 つ決めて、そこへの道案内を受けられる | 「選び直すまで行き先が変わらず、行き先への方角と距離が分かる」で測れる |
| Stamp | 来場者が、足元に押されたスタンプで、混雑や場所の良さを知る | 「地点ごとのスタンプと、押された時刻が分かる」で測れる |
| Landmark | 来場者が、いま見ている建物がどれかを知って、迷いを解く | 「建物にカメラを向けると、一致する建物の名前と位置が分かる」で測れる |

概念にしなかったもの。

- 地図: 表現であり、状態を持たない(前の案の D-004 と同じ)。
- 現在地から行き先への直線: 方角と距離の計算は状態を持たないので、概念にせず、同期の `where` で行う(5 章の `guide-on-choose`)。計算結果の保持は Destination が行う(3.5)。道なりの経路など、保つべき状態が出てきたら、経路を表す状態を Destination に足すか、別の概念にする。【推論】
- 運営の権限: 運営者用のイベント登録ページを作ることが決まった(2026-11-19)ので、運営と来場者を区別する必要がある。運営の識別を保つ概念(Operator など)にするかは【未決】OQ-1。決まるまで、概念にしない(8 章)。
## 3. 概念の仕様

演繹文書 9 章の書式(名前、目的、運用規則、状態、アクション)。型パラメータは、実行時に概念の外から来る型だけ(6 章の問い)。

基本の型として、`String`、`Number`、`Date`/`Time`(AB3 の例が宣言なしで使う)に加え、`Point`(位置)と、列挙(`Kind`、`Level`)を使う。`Point` と列挙を基本の型として扱うのは【推論】。演繹文書の資料では確認できていない。

### 3.1 PlaceList [Building]

`Place` は `register` が作る。建物は外から来る(Landmark の id を指す)ので、型パラメータ `Building` にする。

```
concept Place [Building]
purpose 運営が登録した場所(企画、駐車場、設備)を、来場者がどんな場所があるかとして知れる
principle 運営が場所の名前・種別・位置・説明(建物の中なら、建物と階)を登録する。
来場者が場所の一覧を見ると、登録された場所が見え、1 つを選ぶと、その名前・位置・
説明が分かる。運営が場所を取り除くと、一覧から消える。場所の id は開催期間中は
変わらず、取り除いた場所の id は、あとで別の場所に使われない
state
 places: set Place
 name: Place -> one String
 kind: Place -> one Kind          // Kind = {企画, 駐車場, 案内所, トイレ, 休憩所, ゴミ箱}(案内所〜ゴミ箱は設備。OQ-3)
 location: Place -> one Point
 description: Place -> one String
 building: Place -> lone Building // 場所がある建物。屋外の企画・駐車場には無い
 floor: Place -> lone Number      // 階(1 = 1 階、地下は負)。建物の外には無い
 hours: Place -> set Period       // 開催時間。Period = {開始: Time, 終了: Time}。複数の時間帯を持てる
actions
 register (name: String, kind: Kind, at: Point, text: String, b: Building?, floor: Number?, hours: Period*): Place
 update (p: Place, name: String, kind: Kind, at: Point, text: String, b: Building?, floor: Number?, hours: Period*)
   requires p in places
 remove (p: Place)
   requires p in places
```

- 一覧と個々の情報を見るのは、状態の読み取りで、同期の `where` が行う(10 章。getter は持たない)。
- 建物・階・設備・開催時間を足した(2026-11-22〜23。decisions D-017・D-020)。開催時間は、将来「いまやっている企画」で絞れるよう、文字列でなく開始と終了の組で持つ。設備は検索・絞り込みの対象にしない。
- 場所の id は、端末のタグが id で場所を覚えるため、開催期間中は変えず、取り除いた id を再び使わない。
### 3.2 Search [Item]

`Item` は、検索の対象として外から渡される。`Search` はこれを作らない。

```
concept Search [Item]
purpose 来場者が、名前の一部から、目当ての項目を見つける
principle 項目と、その検索用の文字列を登録する。来場者がキーワードで
探すと、文字列にキーワードを含む項目が見つかり、含まない項目は
見つからない。登録を外した項目は、見つからなくなる
state
 indexed: set Item
 text: Item -> one String
actions
 index (i: Item, text: String)    // 既にあれば置き換える
 unindex (i: Item)
   requires i in indexed
```

- 「文字列にキーワードを含む項目」を求める計算は、同期の `where` が行う。
- 検索に使う文字列(名前だけか、説明も含むか)は、`index` に渡す値で決まるので、概念は変わらない。
- 最低要件は、店舗名の部分一致検索のみ(コメント反映)。`index` に渡す文字列は、最低要件では場所の名前だけにする。5.1 の `index-on-register`、`reindex-on-update` が名前を渡すので、現在の同期で満たしている。
- タグ検索(種類や自分用タグの名前でも見つかる形)は拡張とし、できたら入れる。入れる場合は、タグ名を `index` に渡すか、同期の `where` で Labeling と組み合わせる。Search の仕様は変えずに足せる。【推論】【未決】OQ-8
- Laya(自然言語から曖昧検索できる小規模言語モデル)を、検索の拡張として付ける(コメント反映)。Laya は外部の計算で、概念にしない。同期の `where` で、`Search.text` の文字列に対する曖昧な一致を求める(`direction` や `distance` と同じ扱い)。最低要件は店舗名の部分一致のみで、Laya はできたら付ける。Laya に渡す文字列(名前だけか、説明やタグも含むか)は、`index` に渡す値で決まる。【推論】【未決】OQ-8
### 3.3 Labeling [User, Item]

`Label` は `define` が作るので、型パラメータにしない。前の案は `[Item, Label]` だったが、6 章の問いでは `Label` は外から来ない。

来場者の自分用タグを持つため、`User` を型パラメータに足した(初版は [Item])。`Label` は `define`、`defineFor` が作るので、型パラメータにしない。

```
concept Labeling [User, Item]
purpose 来場者が、項目を種類や自分用のタグで絞って選べる
principle 運営が種類「飲食」を定め、項目に付ける。来場者が種類
「飲食」で絞ると、その種類が付いた項目だけが見える。来場者は、
自分用のタグ「お気に入り」「行きたい」を作って項目に付けられ、
そのタグで絞ると、自分が付けた項目だけが見える。他の来場者の
タグは見えない。タグを外すか、絞り込みを解除すると、元の見え方に戻る
state
 labels: set Label
 title: Label -> one String
 owner: Label -> lone User         // 自分用タグの持ち主。無ければ、運営の種類
 labeled: Item -> set Label
 filtering: User -> set Label      // 絞り込みステータス(来場者ごとの、いまの絞り込み)
actions
 define (title: String): Label
 defineFor (u: User, title: String): Label
 undefine (l: Label)
   requires l in labels and no item has l in labeled
 attach (u: User, i: Item, l: Label)
   requires l in labels and (l has no owner or owner of l is u)
 detach (u: User, i: Item, l: Label)
   requires l in labeled[i] and (l has no owner or owner of l is u)
 release (i: Item)               // i に付いたタグをすべて外す
 applyFilter (u: User, l: Label)
   requires l in labels and (l has no owner or owner of l is u)
 clearFilter (u: User)
```

- `undefine` は、完全性の点検(8 章: 終わりのアクションはあるか)で足した。
- 自分用タグ(コメント反映): 来場者が項目に「お気に入り」「行きたい」を付けられるようにした。`owner` を持つ Label は持ち主の自分用タグで、持ち主にだけ見える。`owner` が無い Label は、運営が定める種類である。目的が同じ(項目をタグで絞って選ぶ)ので、概念は分けず、Labeling に含めた。【推論】
- 絞り込みステータス: `filtering` に、来場者ごとの絞り込みを保つ。「お気に入り」で絞ると、地図に出る点が、お気に入りを付けた場所だけになる(5.1 の `show-places`、5.2 の `apply-filter`)。
### 3.4  CurrentPosition [User]

利用者ごとの現在地を保つので、`User` が要る。【未決】`User` を誰が供給するか(8 章)。

```
concept Position [User]
purpose 来場者が、自分がいま会場のどこにいるかを知る
principle 来場者が位置の利用を許可すると、端末の報告に合わせて、自分の
現在地だけが見える。他の来場者の現在地は見えない。現在地には、
報告の時刻と精度が付く。新しい報告は前の現在地を置き換える。
消すと、現在地は見えなくなる
state
 allowed: set User
 refused: set User
 at: User -> lone Point
 accuracy: User -> lone Number
 takenAt: User -> lone Time
actions
 allow (u: User)
   requires u not in refused
 refuse (u: User)
 update (u: User, p: Point, accuracy: Number, t: Time)
   requires u in allowed
 setManually (u: User, p: Point)   // 【未決】OQ-2
 clear (u: User)
```

- 前の案の `request`(端末に位置を求める)は、概念の状態を変えない、概念の外の出来事なので、アクションにしなかった。許可と拒否の結果が、`allow` と `refuse` になる。
- 端末が位置を報告する出来事は、外からの要求のアクションとして、同期が `update` につなぐ(10 章の言えること 4)。前の案の `system` 印は使わない。
- 利用者の視点で、見えるのは自分の現在地のみ(コメント反映)。他の来場者の現在地を返す同期は書かない。【推論】
### 3.5 Destination [User, Item]

```
concept Destination [User, Item]
purpose 来場者が、向かう先を 1 つ決めて、そこへの道案内を受けられる
principle 来場者が項目を 1 つ選ぶと、それが行き先として保たれる。現在地が
変わるたびに、行き先への方角と距離が更新され、来場者はそれを見て
向かえる。選び直すか解除するまで行き先は変わらず、解除すると
道案内も無くなる
state
 chosen: User -> lone Item
 heading: User -> lone Number     // 行き先への方角
 remaining: User -> lone Number   // 行き先までの距離
 guidedAt: User -> lone Time      // 道案内を更新した時刻
actions
 choose (u: User, i: Item)       // 既にあれば置き換える。道案内は消える
 updateGuide (u: User, heading: Number, remaining: Number, t: Time)
   requires u has chosen
 clear (u: User)
   requires u has chosen
```

- 道案内を Destination に含めた(コメント反映)。方角と距離の計算は状態を必要としないので同期が行い、結果を Destination が保つ。Position を Destination の中で参照しない(独立性)ので、現在地は同期が渡す。【推論】
- 道なりの経路が必要になった場合は、経路を表す状態を Destination に足す。足すかは【未決】。
### 3.6 Stamp

```
concept Stamp
purpose 来場者が、足元にスタンプを押して、混雑や場所の良さを共有し、他の来場者が見て場所を選べる
principle 来場者が自分のいる地点にスタンプ(混雑 1〜5、面白い、美味しい、
よさ など)を押すと、そのスタンプが地点と時刻つきで残る。他の来場者が
地図を見ると、その地点にスタンプが見える。押した端末だけが持つ取り消しの証を
使って取り消すと、スタンプは見えなくなる。他の人には、誰が押したかは分からない
state
 stamps: set Stamp
 kind: Stamp -> one StampKind    // StampKind = {混雑1, 混雑2, 混雑3, 混雑4, 混雑5, 面白い, 美味しい, よさ}【未決】OQ-4
 at: Stamp -> one Point
 proof: Stamp -> one Proof       // 取り消しの証。押した端末だけが持つ。誰が押したかは持たない
 pressedAt: Stamp -> one Time
actions
 press (kind: StampKind, at: Point, t: Time): (Stamp, Proof)
 retract (s: Stamp, proof: Proof)
   requires s in stamps and proof of s is proof
```

- Congestion(場所ごとの混雑の報告)を、Stamp に完全に差し替えた(コメント反映)。混雑は、スタンプの種類(混雑 1〜5)の 1 つとして扱う。古い混雑スタンプを答えに出さない判定は、同期の `where` で行う(5 章の `show-stamps`)。【推論】
  理由: 時間の経過で起きるアクションを、演繹文書の書き方でどう書くかは未確認(10 章)。アクションにすると、そこで詰まる。
- 足元に押す: スタンプは場所(Item)ではなく、押した人の現在地(Point)に付く(確定)。`press-stamp` が Position の現在地を渡す。そのため Stamp は Place を参照せず、Place の削除にも連動しない。
- 押した人を持たない(2026-11-23。D-021): 取り消せるのが押した本人であることは、押したときに返す取り消しの証(`Proof`)の一致で確かめる。端末のデータが消えると取り消せないことは受け入れる。`Proof` は基本の型として扱う。【推論】
### 3.7 Landmark

Landmark は、建物の名前・位置・輪郭を保ち、現在地と向きから、正面にある建物を返す(Slack の構想。2026-11-22 に、基準画像との照合から、輪郭に変えた。D-018)。Landmark は自分で作るので、型パラメータにしない。基本の型として `Polygon`(地図上の多角形)を足す。【推論】

```
concept Landmark
purpose 来場者が、いま見ている建物がどれかを知って、迷いを解く
principle 建物の名前・位置・輪郭が登録される。来場者が端末を建物に向けると、
現在地と向きから、正面にある建物の名前と位置が分かる。正面に建物が
無ければ、分からない。建物が取り除かれると、その建物は分からなくなる
state
 landmarks: set Landmark
 name: Landmark -> one String
 location: Landmark -> one Point
 footprint: Landmark -> one Polygon  // 建物の輪郭(地図上の多角形の頂点列)
actions
 register (name: String, at: Point, footprint: Polygon): Landmark
 update (l: Landmark, name: String, at: Point, footprint: Polygon)
   requires l in landmarks
 remove (l: Landmark)
   requires l in landmarks
```

- 正面の建物を決める計算(現在地から向いている方向へ線を伸ばし、最初に輪郭と交わる建物を選ぶ)は、状態を必要としない計算なので、概念にせず、外部の計算(`Geometry.facing`)として同期の `where` に置く(Laya と同じ扱い)。【推論】
- 映像は使わない。現在地と向きは、端末の中で計算し、サーバーへ送らない(D-018)。
- 輪郭は地図データ(OpenStreetMap)を初めの値にする。運営は、輪郭を確認・修正でき(`update`)、地図データから取り直せる(同期 `reload-footprint`)。一から描く操作は持たない(D-019)。修正した輪郭を取り直しで上書きしてよいかは OQ-17。輪郭の配り方は OQ-16。画像認識(MindAR)は拡張として残す。
- Place(企画、駐車場、設備)と重なる疑い: どちらも位置を持つ。Landmark は建物で、輪郭を持つので、分けた。Place の `kind` に建物を足す案もある。【推論】
## 4. 概念の点検

| 概念 | 特定性(目的 1 つ) | 独立性(他の概念を名前で参照しない) | 完全性(生涯: 準備と終わり) | 型パラメータの判定 |
|---|---|---|---|---|
| Place | 場所を知る 1 つ | 参照なし。`Building` は型パラメータ | register / update / remove | `Place` は自作。`Building` は外から来る。`Point`・`Period` は基本の型(推論) |
| Search | 見つける 1 つ | 参照なし。`Item` は型パラメータ | index / unindex | `Item` は外から来る |
| Labeling | 種類やタグで絞る 1 つ | 参照なし | define / defineFor / undefine、attach / detach / release、applyFilter / clearFilter | User、Item は外から来る。Label は自作 |
| Position | 現在地を保つ 1 つ | 参照なし | allow / refuse、update / clear | `User` は外から来る |
| Destination | 行き先と道案内を保つ 1 つ | 参照なし | choose / updateGuide / clear | `User`、`Item` は外から来る |
| Stamp | 足元のスタンプを残す 1 つ | 参照なし | press / retract | 型パラメータなし。Point・Proof は基本の型(推論) |
| Landmark | 建物を知る 1 つ | 参照なし | register / update / remove | 型パラメータなし。Polygon、Point は基本の型(推論) |

重なりの疑い(特定性・冗長。12 章)。 `Place.kind`(企画 / 駐車場 / 設備)と `Labeling`(飲食、展示など)は、どちらも「種類」を持つ。目的が 1 対 1 なら、まとめてよい形に近い。

- 案 1(この文書の採用): `kind` を `Place` に残す。F4 を外しても、企画・駐車場・設備を区別できる。
- 案 2: `kind` をやめて、「企画」「駐車場」「設備」も `Labeling` の種類にする。冗長が無くなるが、F4(任意)を外せなくなる。
- 【未決】OQ-3。決まるまで、案 1 のまま。
## 5. 同期

概念をつなぐのは、同期だけ(10 章)。書式は `when` / `where` / `then`。外からの要求も、アクションとして書く(`Web.request`)。

応答の返し方は【未確認】。 演繹文書に、要求への答えを返す書き方は無い。ここでは、読み取りの結果を `Web.respond (…)` で返すと書く。【推論】。

権限(誰が実行できるか)は、`where` に書く(10 章)。 ただし、権限の根拠になる概念の状態が、まだ無い。【未決】OQ-1。該当の行は、`who may …` と書いて、決まるまで確定しない。

### 5.1 場所と、その連動(F1)

```
sync register-place
when Web.request (registerPlace, who, name, kind, at, text, b, floor, hours)
where who may manage places                        // 【未決】OQ-1、OQ-5
then p = Place.register (name, kind, at, text, b, floor, hours)

sync update-place
when Web.request (updatePlace, who, p, name, kind, at, text, b, floor, hours)
where who may manage places
then Place.update (p, name, kind, at, text, b, floor, hours)

sync remove-place
when Web.request (removePlace, who, p)
where who may manage places
then Place.remove (p)

sync show-places
when Web.request (showPlaces)
where p in Place.places, with Place.name, Place.kind, Place.location, Place.description,
      Place.building, Place.floor, Place.hours, and the labels attached to p
      // 絞り込みは端末で行う(D-012・D-014)。運営の種類どうしは OR、自分用のタグは AND(D-016)。設備は絞り込まない
then Web.respond (the places, each with its labels)

// Place の変化に、他の概念を連動させる
sync index-on-register
when Place.register (name, kind, at, text, b, floor, hours): p
then Search.index (p, name)

sync reindex-on-update
when Place.update (p, name, kind, at, text, b, floor, hours)
then Search.index (p, name)

sync cascade-remove
when Place.remove (p)
then Search.unindex (p)
     Labeling.release (p)

sync clear-destinations-on-remove
when Place.remove (p)
where Destination.chosen of some user u is p
then Destination.clear (u)
```

- `unindex`、`release` は、事前条件が成り立たないとき、概念が拒否できる(8 章)。取り除く場所に、登録が無い場合がそうである。この場合の同期の振る舞いは【未確認】。実装前に、事前条件を外すか、`where` で絞るかを決める。【未決】
- 場所の登録は、運営者用のイベント登録ページから行う(2026-11-19 確定)。登録ページからの要求が `register-place` の `when` になる。スプレッドシートの取り込みは、使う場合だけ `when` を替える。`index-on-register` は変わらない。
```
sync search-places
when Web.request (search, keyword)
where p in Search.indexed
      Search.text of p contains keyword
then Web.respond (p, with Place.name, Place.location)
```

- 一致が無いとき、空の答えを返す(`criteria.yaml` F1 の失敗時の扱い)。
- 最低要件(店舗名の部分一致)は、`search-places` が、`index` に渡された名前に対して満たす。タグ検索を入れる場合は OQ-8 で決める。
```
sync search-places-laya
when Web.request (searchNatural, sentence)
where p in Search.indexed
      Laya.matches (sentence, Search.text of p)      // 【推論】外部の計算。自然言語からの曖昧一致
then Web.respond (p, with Place.name, Place.location)
```

- `search-places-laya` は、`search-places` と並べて置く。Laya が使えないときは、`search-places`(部分一致)に戻せる。`Laya.matches` の書き方は【未確認】。【未決】OQ-8
### 5.2 種類と自分用タグ・絞り込み(F4)

```
sync define-label
when Web.request (defineLabel, who, title)
where who may manage places
then Labeling.define (title)

sync show-labels
when Web.request (showLabels)
where l in Labeling.labels, and Labeling.owner of l is none     // 運営の種類。種類のチップの名前に使う
then Web.respond (the labels)

sync remove-label
when Web.request (removeLabel, who, l)
where who may manage places                        // 【未決】OQ-1。どの場所にも付いていなければ、undefine できる
then Labeling.undefine (l)

sync assign-label
when Web.request (assignLabel, who, p, l)
where p in Place.places
      who may manage places
then Labeling.attach (who, p, l)

sync define-my-tag
when Web.request (defineMyTag, u, title)           // 例: お気に入り、行きたい
then Labeling.defineFor (u, title)

sync mark-place
when Web.request (markPlace, u, p, l)
where p in Place.places
then Labeling.attach (u, p, l)

sync unmark-place
when Web.request (unmarkPlace, u, p, l)
then Labeling.detach (u, p, l)

sync apply-filter
when Web.request (applyFilter, u, l)
then Labeling.applyFilter (u, l)

sync clear-filter
when Web.request (clearFilter, u)
then Labeling.clearFilter (u)

sync browse-by-label
when Web.request (browse, l)
where p in Labeling.labeled with l
then Web.respond (p, with Place.name, Place.location)
```

- 来場者の操作(`define-my-tag`、`mark-place`、`unmark-place`、`apply-filter`、`clear-filter`)は、来場者本人の `u` で実行する。運営の操作(`define-label`、`assign-label`)の権限と、`who` を User として扱うかは OQ-1。
- 「お気に入り」で絞った状態で `show-places` を呼ぶと、地図に出る点は、お気に入りを付けた場所だけになる(絞り込みステータスは `filtering` に保たれ、応答にも含まれる)。
### 5.3 現在地・行き先(F2)

```
sync allow-location
when Web.request (allowLocation, u)
then Position.allow (u)

sync refuse-location
when Web.request (refuseLocation, u)
then Position.refuse (u)

sync report-position
when Web.request (reportPosition, u, p, accuracy, t)
then Position.update (u, p, accuracy, t)

sync set-position
when Web.request (setPosition, u, p)               // 【未決】OQ-2
then Position.setManually (u, p)

sync choose-destination
when Web.request (chooseDestination, u, place)
where place in Place.places
then Destination.choose (u, place)

sync guide-on-choose
when Destination.choose (u, d)
where Position.at of u is a
      Place.location of d is b
then Destination.updateGuide (u, direction (a, b), distance (a, b), Position.takenAt of u)

sync guide-on-move
when Position.update (u, a, accuracy, t)
where Destination.chosen of u is d
      Place.location of d is b
then Destination.updateGuide (u, direction (a, b), distance (a, b), t)

sync show-route
when Web.request (showRoute, u)
where Destination.chosen of u is d
      Destination.heading of u is h
      Destination.remaining of u is r
then Web.respond (d, with Place.name, h, r, Destination.guidedAt of u)
```

- `direction` と `distance` は、状態を必要としない計算(10 章の `where` の定義)で、同期が行う。結果は `Destination.updateGuide` に渡して保つ。経路を別の概念にしなかった理由は、2 章。
- 現在地が無い、または拒否されたときは、`guide-on-choose`、`guide-on-move` が起きず、道案内が付かない。このとき `show-route` も `where` が成り立たず、答えない。利用者に何を見せるかは、同期を足して決める。【未決】OQ-2。
### 5.4 スタンプ(F3)

```
sync press-stamp
when Web.request (pressStamp, u, kind, now)
where Position.at of u is p                         // 足元 = 押す人の現在地
then Stamp.press (kind, p, now)                     // 取り消しの証が返る

sync retract-stamp
when Web.request (retractStamp, s, proof)
then Stamp.retract (s, proof)

sync show-stamps
when Web.request (showStamps, now)
where s in Stamp.stamps
      Stamp.kind of s is a congestion stamp and the age (now - Stamp.pressedAt of s) is within 30 minutes,
      or Stamp.kind of s is a feeling stamp and now is before the closing time of that day
      // 仮置きの値(D-022)。【未決】OQ-4
then Web.respond (s, with Stamp.kind, Stamp.at, Stamp.pressedAt)
```

- 混雑スタンプは、許容時間を過ぎると `where` に合わず、答えに出ない。感想のスタンプ(面白い、美味しい、よさ)は、その日の閉場まで見える。期限の値(混雑 30 分、感想は閉場まで)は仮置きで、チームが決める。【未決】OQ-4
### 5.5 建物の判定と、迷いの解消(F5)

```
sync register-landmark
when Web.request (registerLandmark, who, name, at)
where who may manage places                        // 【未決】OQ-1
      Osm.outline (at) is footprint                // 【推論】外部の計算。輪郭は地図データから取る(D-019)
then l = Landmark.register (name, at, footprint)

sync update-landmark
when Web.request (updateLandmark, who, l, name, at, footprint)
where who may manage places
then Landmark.update (l, name, at, footprint)

sync reload-footprint
when Web.request (reloadFootprint, who, l)
where who may manage places
      l in Landmark.landmarks
      Osm.outline (Landmark.location of l) is footprint     // 取れなければ、輪郭は変えずに断る
then Landmark.update (l, Landmark.name of l, Landmark.location of l, footprint)

sync remove-landmark
when Web.request (removeLandmark, who, l)
where who may manage places
then Landmark.remove (l)

sync show-landmarks
when Web.request (showLandmarks)
where l in Landmark.landmarks
then Web.respond (the landmarks)

sync recognize-building
when Web.request (recognizeBuilding, u, heading)   // 現在地と向きは端末内で扱い、送信しない(D-018)
where l in Landmark.landmarks
      Geometry.facing (Position.at of u, heading, Landmark.footprint of l)   // 【推論】外部の計算
then Web.respond (l, with Landmark.name, Landmark.location)

sync show-building-events
when Web.request (showBuildingEvents, u, heading)
where l in Landmark.landmarks
      Geometry.facing (Position.at of u, heading, Landmark.footprint of l)
      p in Place.places with Place.building of p is l
then Web.respond (l, the places p, with Place.name, Place.location)

sync show-no-events
when Web.request (showBuildingEvents, u, heading)
where l in Landmark.landmarks
      Geometry.facing (Position.at of u, heading, Landmark.footprint of l)
      no p in Place.places with Place.building of p is l
then Web.respond (l, no events)                       // 「この建物には企画がない」を見せる
```

- 「この建物には企画がない」を見せる(Slack の構想)ために、`show-no-events` を分けた。`show-building-events` は、企画が 1 件以上あるときだけ起きる。
- 建物の企画は、場所の `building` が建物と一致するもので決める(2026-11-22)。以前の「建物の近く(near)」は使わない。OQ-10 のうち near の範囲は、要らなくなった。
- 運営は輪郭を一から描かない。建物を登録するときに地図データから取り込み、ずれたときは `update` で直すか、`reload-footprint` で取り直す(D-019)。
- 「迷っているか」の判定は、まだ書いていない。Position と Destination から、`where` で計算できるか(行き先から遠ざかる、同じ所に長く留まる、など)を決める。【未決】OQ-10
## 6. 機能 × 概念・同期の対応(被覆)

| 機能 | 概念 | 同期 |
|---|---|---|
| F1 | Place、Search | register-place、update-place、remove-place、show-places、index-on-register、reindex-on-update、cascade-remove、search-places、search-places-laya |
| F2 | Place、Position、Destination | allow-location、refuse-location、report-position、set-position、choose-destination、guide-on-choose、guide-on-move、show-route、clear-destinations-on-remove |
| F3 | Position、Stamp | press-stamp、retract-stamp、show-stamps |
| F4 | Place、Labeling | define-label、show-labels、remove-label、assign-label、define-my-tag、mark-place、unmark-place、apply-filter、clear-filter、browse-by-label、show-places、cascade-remove |
| F5 | Place、Landmark | register-landmark、update-landmark、reload-footprint、remove-landmark、show-landmarks、recognize-building、show-building-events、show-no-events |

- どの機能も、概念と同期の組で実現される。どの機能にも使われない概念は無い。
- F4 を外すと、`Labeling` と、5.2 の同期が丸ごと外れる。`cascade-remove` の `Labeling.release` の行と、`show-places` の絞り込みの行も外す。他の概念は変わらない。
型パラメータの当てはめ。 古い書き方(11 章の言えること 2)で書く。この組み合わせは、ジャクソンの資料に書かれていない。【推論】

```
app NAsVI includes
  Place,
  Search [Place.Place],
  Labeling [Place.Place],
  Position [?],
  Destination [?, Place.Place],
  Stamp [?],
  Landmark
```

`?` は、`User` をどの概念が作るか(8 章)。決まるまで、埋めない。

## 7. 前の案(`concepts.yaml`)からの変更

| # | 前の案 | この文書 | 理由 |
|---|---|---|---|
| 1 | `Place.get`、`Place.list`、`Search.query`、`Labeling.itemsWith`、`Destination.current`、`Congestion.read`、`Congestion.readAll`(状態を読むだけのアクション) | 削除。読み取りは同期の `where` | 概念は、getter を持たない(10 章)。読むのは `where`。運用規則の最後の「見ると〜」は、アクションではなく状態の読み取りとして書いた(【推論】。T-criteria の「状態が更新されるだけでは何かが欠けている」に合わせた) |
| 2 | `Labeling [Item, Label]` | `Labeling [Item]` | `Label` は `define` が作る。外から来ない(6 章の問い) |
| 3 | `system: true` の `Position.update`、`Congestion.expire` | `update` は外からの要求のアクションとして、同期がつなぐ。`expire` は削除し、`where` で古さを判定 | 時間の経過で起きるアクションの書き方が未確認(10 章)。始まりは外からの要求のアクション |
| 4 | `Position.request`(端末に位置を求める) | `allow` / `refuse` | 求めるのは外の出来事で、状態を変えない。変わるのは、許可と拒否の結果 |
| 5 | `Position`、`Destination`、`Congestion` の状態が、利用者単位かどうか暗黙 | `Position [User]`、`Destination [User, Item]` | 利用者ごとの状態は、`User -> …` で書く(7 章)。`Congestion` は全員で共有するので `User` を持たない |
| 6 | `Search`、`Labeling` の状態が、関係の左辺だけ | `indexed: set Item`、`labels: set Label` を足した | AB3 の書式(`events: set Event` と `date: Event -> one Date` の組)に合わせた(7 章) |
| 7 | `Labeling` に終わりのアクションが無い | `undefine` を足した | 完全性(8 章) |
| 8 | 同期に、`Place.update` / `remove` を起こす要求が無い | `update-place`、`remove-place` を足した | アクションはあるが、起こす同期が無かった |
| 9 | 事前条件に「なし」と書く | 書かない | 演繹文書の書式に、書く欄が無い。事前条件が無いアクションは、`requires` を省く |
| 10 | 同期の `where` が、日本語の文だけ | 状態への問い合わせの形で書いた | `where` は状態への問い合わせ(10 章) |
| 11 | Place に建物・階・開催時間が無い。Kind は企画と駐車場。 | `Place [Building]` に building・floor・hours。Kind に設備 4 種 | 画面・API 設計が前提にした(D-017・D-020) |
| 12 | Landmark が基準画像を持ち、映像と照合する | footprint(輪郭)を持ち、現在地と向きから正面の建物を決める。輪郭は OpenStreetMap から取る | D-018・D-019。画像認識は拡張として残す |
| 13 | Stamp が押した人(by)を持つ | 取り消しの証(proof)の一致で確かめる。by をやめた | D-021。API-13・19 と一致 |
| 14 | show-places が絞り込みを行う | 絞り込みは端末。サーバーは運営の種類を付けて返す | D-012・D-014・D-016 |
| 15 | showLabels・removeLabel・showLandmarks・reloadFootprint が無い | 同期を足した | API-6・10、D-019 |

## 8. 決めること・確認できないこと

チームが決めること(`open-questions.yaml` に対応)。

| 項目 | この文書で止まっている所 |
|---|---|
| OQ-1 場所の登録者(旧: 混雑の報告者) | who may manage places。運営者用のイベント登録ページを作ることが決まった(2026-11-19)ので、運営と来場者の区別が必要になった。スタンプは来場者が押すので、報告者の権限(who may report)は不要になった。権限の根拠となる状態が要る。決まったら、その状態を持つ概念を足す(候補は、運営の識別を保つ概念。足すかは、運営と来場者を区別する必要があるかによる) |
| OQ-2 現在地を手で指定するか | `Position.setManually`、`set-position`、位置が取れないときの見せ方 |
| OQ-3 F4 を入れるか、種類と `Place.kind` の線引き | 4 章の「重なりの疑い」。案 1 か案 2。設備を `Kind` に足した(D-017)ので、線引きの対象が増えた |
| OQ-4 スタンプの種類と、混雑スタンプを古いとみなす時間 | StampKind の列挙(混雑 1〜5、面白い、美味しい、よさ など)。show-stamps の許容時間は、仮置きの値(混雑 30 分、感想は閉場まで。D-022) |
| OQ-5 場所データの入れ方 | 運営者用の登録ページを作ることが決まった(2026-11-19)。register-place の when は、その登録ページからの要求になる。スプレッドシートの取り込みは、使う場合だけ |
| OQ-12 来場者(`User`)を誰が供給するか | Position [User]、Destination [User, Item]、Labeling [User, Item]、Stamp は User を持たなくなった(D-021)。来場者を識別しないなら、利用者ごとの状態は、端末の中に置く形になる。その場合、Position、Destination を概念として残すかも決める |
| OQ-8 タグ検索と Laya の組み込み | タグ名を index に渡すか。Laya(自然言語から曖昧検索できる小規模言語モデル)の入出力形式と、動かす場所(端末かサーバか)。search-places-laya の Laya.matches の書き方 |
| OQ-9 待ち合わせ(合言葉) | 周囲のオンライン者に合言葉を共有する案(Slack)。入れる場合は、グループと位置の共有を保つ概念(Meetup など)が要る。Position の「見えるのは自分の現在地のみ」と衝突するので、共有を許可した相手にだけ見せる形にするかを決める。来場者(User)の識別も要る |
| OQ-10 迷いの判定と「企画なし」の表示 | 「迷っている」の判定方法(行き先から遠ざかる、同じ所に長く留まる、など)。near の範囲。判定を概念にするか、同期の where の計算にするか |
| OQ-11 Landmark の認識の実装(閉じた) | 映像でなく、現在地・向き・建物の輪郭で決めることにした(D-018)。画像認識(MindAR)は拡張 |
| OQ-14 階ごとの見取り図を新概念にするか | 階の画像と、四隅の緯度経度。Place・Landmark とは目的が違う。概念には足していない |
| OQ-16 建物の輪郭の配り方 | 端末へ静的ファイルで同梱するか、API で返すか |

演繹文書で確認できていないこと(この文書が【推論】で置いた所)。

1. 要求への答えの書き方(`Web.respond`)。
2. 時間の経過で起きる出来事(古い混雑スタンプ)の扱い。`where` で判定する形にした。
3. 状態を読むだけのアクションを、すべて同期の `where` に出した形。運用規則での書き方も含む。
4. `Point` と列挙(`Kind`、`StampKind`)を、基本の型として扱うこと。
5. 事前条件が成り立たないとき、同期がどう振る舞うか(5.1 の `cascade-remove`)。
6. 新しい書き方の同期と、古い書き方の型の当てはめを併せて使うこと(6 章末)。
7. Labeling に、来場者の自分用タグ(`owner`)と絞り込み状態(`filtering`)を持たせた形。目的が同じなので 1 概念にしたが、運営の種類と自分用タグを別の概念に分ける案もある。
8. 道案内の結果(方角、距離)を Destination の状態に持たせ、同期が更新する形。
9. Stamp を、場所(Place)ではなく地点(Point)に付ける形(設計は確定。演繹文書の例には無い)。
10. `Polygon`・`Period`・`Proof` を、基本の型として扱うこと。
11. 正面の建物の判定(`Geometry.facing`)と、輪郭の取得(`Osm.outline`)を、外部の計算として同期の `where` に置いた形(Laya と同じ扱い)。名前は仮。
## 9. 変更履歴

この文書の正本は、Notion の「NAsVI の概念設計」と、このリポジトリで二重になっている。Notion の末尾「9. 変更履歴」に、各版の変更前と変更後の本文がある。リポジトリでは、git の履歴で辿る。

| 版 | 日付 | 内容 |
|---|---|---|
| r0 | 2026-11-17 | 初版。演繹文書の規則で、前の案(concepts.yaml)を組み直した |
| r1 | 2026-11-19 | コメント 4 件の反映(Search の最低要件、Position の利用者視点、Destination に道案内、Labeling に自分用タグ)。Congestion を Stamp に差し替え。絞り込みステータスを追加 |
| r2 | 2026-11-19 | Laya の定義(自然言語から曖昧検索できる小規模言語モデル)。Stamp を地点(Point)に確定 |
| r3 | 2026-11-19 | Slack のメモの取り込み(Landmark、迷いの判定、待ち合わせ、運営者用の登録ページ) |
| r4 | 2026-11-19 | OQ 番号を、`open-questions.yaml` に揃える(OQ-6〜9 → OQ-8〜11、OQ-12 を新設) |
| r5 | 2026-11-23 | API 設計・デザインシステムとの擦り合わせ(D-017〜D-022)。Place に建物・階・開催時間・設備、Landmark を輪郭に、Stamp の取り消しを証に、絞り込みを端末に。同期 show-labels・remove-label・show-landmarks・reload-footprint を追加 |
