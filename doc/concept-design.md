# NAsVI の概念設計(ジャクソンの形)

作成: 2026-11-17 / 状態: draft(作成者の案。チームの合意前)

## 0. この文書について

**やったこと。** `concept-design/docs/concept-design-deductive.md`(以下「演繹文書」)の規則に従って、ハッカソンの内容から概念設計を組み直した。

**材料。** `concept-design/examples/hackathon/` の `input.yaml`(機能 F1〜F4)、`concepts.yaml`(前の案)、`decisions.yaml`、`open-questions.yaml`、`criteria.yaml`、`docs/board-p1.webp`(概念設計ボード)。
これらは材料であり、規則の根拠ではない。規則は演繹文書だけに拠る(章番号は演繹文書の章)。

**前の案との関係。** 前の案(`concepts.yaml`)は、演繹文書の規則で点検すると直す所があった。変更点は 7 章にまとめた。

**記号。** 【推論】は作成者の判断で、ジャクソンの資料では確認できていない。【未決】はチームが決めること(`open-questions.yaml` の OQ-n)。

## 1. 入力: 機能(価値の単位)

`input.yaml` は draft(ボードの画像から起こした値を含む。★要確認)。この文書は、その F1〜F4 をそのまま使う。

| ID | 機能 | 価値 |
|---|---|---|
| F1 | 行きたい場所を見つける | 目当ての企画や駐車場を、名前の一部から探し出せる |
| F2 | 行き先へ向かう | 現在地と行き先の位置関係をつかんで、迷わず向かえる |
| F3 | 混雑を知る | 混んでいる場所を知って、行く先や時間を選べる |
| F4 | 種類から選ぶ(任意) | 行き先が決まっていない人が、種類から場所を選べる |

## 2. 概念を分ける(特定性・完全性・独立性。1、12 章)

機能を目的ごとに分けた。目的 1 つに概念 1 つ(12 章)。

| 概念 | 目的(1 文) | 目的の点検(4 章: 必要に焦点・特定的・評価できる) |
|---|---|---|
| Place | 来場者が、会場にどんな場所があるかを知る | 「登録した場所を、来場者が全件見られるか」で測れる |
| Search | 来場者が、名前の一部から目当ての項目を見つける | 「入れた語を含む項目が出て、含まない項目が出ない」で測れる |
| Labeling | 来場者が、項目を種類で絞って選べる | 「種類を選ぶと、その種類の項目だけが出る」で測れる |
| Position | 来場者が、自分がいま会場のどこにいるかを知る | 「現在地が、いつの情報かと共に分かる」で測れる |
| Destination | 来場者が、向かう先を 1 つ決めて保つ | 「選び直すまで、行き先が変わらない」で測れる |
| Congestion | 来場者が、混んでいる場所を避けられる | 「場所ごとの最新の混雑と、その時刻が分かる」で測れる |

**概念にしなかったもの。**

- 地図: 表現であり、状態を持たない(前の案の D-004 と同じ)。
- 現在地から行き先への直線: 状態を持たない計算なので、概念にせず、同期の `where` で計算する(5 章の `show-route`)。道なりの経路など、保つべき状態が出てきたら、概念にする。【推論】
- 運営の権限: 【未決】OQ-1 が決まるまで、概念にしない(8 章)。

## 3. 概念の仕様

演繹文書 9 章の書式(名前、目的、運用規則、状態、アクション)。型パラメータは、実行時に概念の外から来る型だけ(6 章の問い)。

基本の型として、`String`、`Number`、`Date`/`Time`(AB3 の例が宣言なしで使う)に加え、`Point`(位置)と、列挙(`Kind`、`Level`)を使う。`Point` と列挙を基本の型として扱うのは【推論】。演繹文書の資料では確認できていない。

### 3.1 Place(型パラメータなし)

`Place` は `register` が作るので、型パラメータにしない。

```
concept Place
purpose 来場者が、会場にどんな場所があるかを知る
principle 運営が場所の名前・種別・位置・説明を登録する。来場者が場所の
一覧を見ると、登録された場所が見え、1 つを選ぶと、その名前・位置・
説明が分かる。運営が場所を取り除くと、一覧から消える
state
 places: set Place
 name: Place -> one String
 kind: Place -> one Kind          // Kind = {企画, 駐車場}
 location: Place -> one Point
 description: Place -> one String
actions
 register (name: String, kind: Kind, at: Point, text: String): Place
 update (p: Place, name: String, kind: Kind, at: Point, text: String)
   requires p in places
 remove (p: Place)
   requires p in places
```

- 一覧と個々の情報を見るのは、状態の読み取りで、同期の `where` が行う(10 章。getter は持たない)。

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

### 3.3 Labeling [Item]

`Label` は `define` が作るので、型パラメータにしない。前の案は `[Item, Label]` だったが、6 章の問いでは `Label` は外から来ない。

```
concept Labeling [Item]
purpose 来場者が、項目を種類で絞って選べる
principle 運営が種類「飲食」を定め、項目に付ける。来場者が種類
「飲食」で絞ると、その種類が付いた項目だけが見える。種類を外すと、
その項目は絞り込みに出なくなる
state
 labels: set Label
 title: Label -> one String
 labeled: Item -> set Label
actions
 define (title: String): Label
 undefine (l: Label)
   requires l in labels and no item has l in labeled
 attach (i: Item, l: Label)
   requires l in labels
 detach (i: Item, l: Label)
   requires l in labeled[i]
 release (i: Item)               // i に付いた種類をすべて外す
```

- `undefine` は、完全性の点検(8 章: 終わりのアクションはあるか)で足した。

### 3.4 Position [User]

利用者ごとの現在地を保つので、`User` が要る。【未決】`User` を誰が供給するか(8 章)。

```
concept Position [User]
purpose 来場者が、自分がいま会場のどこにいるかを知る
principle 来場者が位置の利用を許可し、端末が位置を報告すると、現在地が
報告の時刻と精度つきで保たれる。新しい報告は前の現在地を置き換える。
消すと、現在地は無くなる
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

### 3.5 Destination [User, Item]

```
concept Destination [User, Item]
purpose 来場者が、向かう先を 1 つ決めて保つ
principle 来場者が項目を 1 つ選ぶと、それが行き先として保たれ、選び直すか
解除するまで変わらない
state
 chosen: User -> lone Item
actions
 choose (u: User, i: Item)       // 既にあれば置き換える
 clear (u: User)
   requires u has chosen
```

### 3.6 Congestion [Item]

```
concept Congestion [Item]
purpose 来場者が、混んでいる場所を避けられる
principle 誰かが項目の混み具合を報告する。来場者が見ると、報告された段階と、
報告の時刻が分かる。新しい報告は、前の報告を置き換える
state
 reported: set Item
 level: Item -> one Level        // Level = {空き, やや混雑, 混雑}【未決】OQ-4
 reportedAt: Item -> one Time
actions
 report (i: Item, level: Level, t: Time)   // 既にあれば置き換える
 forget (i: Item)
   requires i in reported
```

- 報告が古くなったとき「不明」として扱うことは、同期の `where` で判定する(5 章の `show-congestion`)。【推論】
  理由: 時間の経過で起きるアクションを、演繹文書の書き方でどう書くかは未確認(10 章)。アクションにすると、そこで詰まる。

## 4. 概念の点検

| 概念 | 特定性(目的 1 つ) | 独立性(他の概念を名前で参照しない) | 完全性(生涯: 準備と終わり) | 型パラメータの判定 |
|---|---|---|---|---|
| Place | 場所を知る 1 つ | 参照なし | register / update / remove | `Place` は自作。`Point` は基本の型(推論) |
| Search | 見つける 1 つ | 参照なし。`Item` は型パラメータ | index / unindex | `Item` は外から来る |
| Labeling | 種類で絞る 1 つ | 参照なし | define / undefine、attach / detach / release | `Item` は外から来る。`Label` は自作 |
| Position | 現在地を保つ 1 つ | 参照なし | allow / refuse、update / clear | `User` は外から来る |
| Destination | 行き先を保つ 1 つ | 参照なし | choose / clear | `User`、`Item` は外から来る |
| Congestion | 混雑を保つ 1 つ | 参照なし | report / forget | `Item` は外から来る |

**重なりの疑い(特定性・冗長。12 章)。** `Place.kind`(企画 / 駐車場)と `Labeling`(飲食、展示など)は、どちらも「種類」を持つ。目的が 1 対 1 なら、まとめてよい形に近い。
- 案 1(この文書の採用): `kind` を `Place` に残す。F4 を外しても、企画と駐車場を区別できる。
- 案 2: `kind` をやめて、「企画」「駐車場」も `Labeling` の種類にする。冗長が無くなるが、F4(任意)を外せなくなる。
- 【未決】OQ-3。決まるまで、案 1 のまま。

## 5. 同期

概念をつなぐのは、同期だけ(10 章)。書式は `when` / `where` / `then`。外からの要求も、アクションとして書く(`Web.request`)。

**応答の返し方は【未確認】。** 演繹文書に、要求への答えを返す書き方は無い。ここでは、読み取りの結果を `Web.respond (…)` で返すと書く。【推論】。

**権限(誰が実行できるか)は、`where` に書く(10 章)。** ただし、権限の根拠になる概念の状態が、まだ無い。【未決】OQ-1。該当の行は、`who may …` と書いて、決まるまで確定しない。

### 5.1 場所と、その連動(F1)

```
sync register-place
when Web.request (registerPlace, who, name, kind, at, text)
where who may manage places                        // 【未決】OQ-1、OQ-5
then p = Place.register (name, kind, at, text)

sync update-place
when Web.request (updatePlace, who, p, name, kind, at, text)
where who may manage places
then Place.update (p, name, kind, at, text)

sync remove-place
when Web.request (removePlace, who, p)
where who may manage places
then Place.remove (p)

sync show-places
when Web.request (showPlaces)
where p in Place.places, with Place.name, Place.kind, Place.location, Place.description
then Web.respond (the places)

// Place の変化に、他の概念を連動させる
sync index-on-register
when Place.register (name, kind, at, text): p
then Search.index (p, name)

sync reindex-on-update
when Place.update (p, name, kind, at, text)
then Search.index (p, name)

sync cascade-remove
when Place.remove (p)
then Search.unindex (p)
     Labeling.release (p)
     Congestion.forget (p)

sync clear-destinations-on-remove
when Place.remove (p)
where Destination.chosen of some user u is p
then Destination.clear (u)
```

- `unindex`、`release`、`forget` は、事前条件が成り立たないとき、概念が拒否できる(8 章)。取り除く場所に、登録や報告が無い場合がそうである。この場合の同期の振る舞いは【未確認】。実装前に、事前条件を外すか、`where` で絞るかを決める。【未決】
- 場所をスプレッドシートから取り込む場合(OQ-5)は、`register-place` の `when` を、取り込みの要求に替えるだけでよい。`index-on-register` は変わらない。

```
sync search-places
when Web.request (search, keyword)
where p in Search.indexed
      Search.text of p contains keyword
then Web.respond (p, with Place.name, Place.location)
```

- 一致が無いとき、空の答えを返す(`criteria.yaml` F1 の失敗時の扱い)。

### 5.2 種類(F4)

```
sync define-label
when Web.request (defineLabel, who, title)
where who may manage places
then Labeling.define (title)

sync assign-label
when Web.request (assignLabel, who, p, l)
where p in Place.places
      who may manage places
then Labeling.attach (p, l)

sync browse-by-label
when Web.request (browse, l)
where p in Labeling.labeled with l
then Web.respond (p, with Place.name, Place.location)
```

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

sync show-route
when Web.request (showRoute, u)
where Position.at of u is a
      Destination.chosen of u is d
      Place.location of d is b
then Web.respond (direction (a, b), distance (a, b), Position.takenAt of u)
```

- `direction` と `distance` は、状態を必要としない計算(10 章の `where` の定義)。経路を概念にしなかった理由は、2 章。
- 現在地が無い、または拒否されたときの答えは、`where` が成り立たないので、`show-route` が起きない。このとき利用者に何を見せるかは、同期を足して決める。【未決】OQ-2。

### 5.4 混雑(F3)

```
sync report-congestion
when Web.request (reportCongestion, who, place, level, now)
where place in Place.places
      who may report                                // 【未決】OQ-1
then Congestion.report (place, level, now)

sync show-congestion
when Web.request (showCongestion, now)
where place in Congestion.reported
      level is Congestion.level of place
      the age (now - Congestion.reportedAt of place) is within the limit   // 【未決】OQ-4
then Web.respond (place, level, Congestion.reportedAt of place)
```

- 許容時間を過ぎた場所は `where` に合わず、答えに出ない。「不明」を明示して見せるなら、同期を足す。【未決】OQ-4

## 6. 機能 × 概念・同期の対応(被覆)

| 機能 | 概念 | 同期 |
|---|---|---|
| F1 | Place、Search | register-place、update-place、remove-place、show-places、index-on-register、reindex-on-update、cascade-remove、search-places |
| F2 | Place、Position、Destination | allow-location、refuse-location、report-position、set-position、choose-destination、show-route、clear-destinations-on-remove |
| F3 | Place、Congestion | report-congestion、show-congestion、cascade-remove |
| F4 | Place、Labeling | define-label、assign-label、browse-by-label、cascade-remove |

- どの機能も、概念と同期の組で実現される。どの機能にも使われない概念は無い。
- F4 を外すと、`Labeling` と、5.2 の同期が丸ごと外れる。`cascade-remove` の `Labeling.release` の行も外す。他の概念は変わらない。

**型パラメータの当てはめ。** 古い書き方(11 章の言えること 2)で書く。この組み合わせは、ジャクソンの資料に書かれていない。【推論】

```
app NAsVI includes
  Place,
  Search [Place.Place],
  Labeling [Place.Place],
  Position [?],
  Destination [?, Place.Place],
  Congestion [Place.Place]
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

## 8. 決めること・確認できないこと

**チームが決めること(`open-questions.yaml` に対応)。**

| 項目 | この文書で止まっている所 |
|---|---|
| OQ-1 混雑の報告者、場所の登録者 | `who may manage places`、`who may report`。権限の根拠となる状態が要る。決まったら、その状態を持つ概念を足す(候補は、運営の識別を保つ概念。足すかは、運営と来場者を区別する必要があるかによる) |
| OQ-2 現在地を手で指定するか | `Position.setManually`、`set-position`、位置が取れないときの見せ方 |
| OQ-3 F4 を入れるか、種類と `Place.kind` の線引き | 4 章の「重なりの疑い」。案 1 か案 2 |
| OQ-4 混雑の段階数と、古いとみなす時間 | `Level` の列挙、`show-congestion` の許容時間 |
| OQ-5 場所データの入れ方 | `register-place` の `when` |
| 新規: 来場者(`User`)を誰が供給するか | `Position [User]`、`Destination [User, Item]`。来場者を識別しないなら、利用者ごとの状態は、端末の中に置く形になる。その場合、`Position`、`Destination` を概念として残すかも決める |

**演繹文書で確認できていないこと(この文書が【推論】で置いた所)。**

1. 要求への答えの書き方(`Web.respond`)。
2. 時間の経過で起きる出来事(古い報告)の扱い。`where` で判定する形にした。
3. 状態を読むだけのアクションを、すべて同期の `where` に出した形。運用規則での書き方も含む。
4. `Point` と列挙(`Kind`、`Level`)を、基本の型として扱うこと。
5. 事前条件が成り立たないとき、同期がどう振る舞うか(5.1 の `cascade-remove`)。
6. 新しい書き方の同期と、古い書き方の型の当てはめを併せて使うこと(6 章末)。
