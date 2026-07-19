# Visual Hierarchy and Information Architecture

## 1. 3秒確認

Today を3秒見て、次に答えられる必要があります。

- 何の日を見ているか。
- 現在時刻はどこか。
- 現在 / 次の予定は何か。
- 予定を作成する主操作はどれか。
- overview と detail のどちらを操作するか。
- sync / conflict の重大状態があるか。

答えられない場合は P0 / P1 を判定します。

## 2. 情報階層

推奨優先度:

1. Today date / navigation / create action。
2. current / next / remaining / active Focus。
3. detail timeline と selected schedule。
4. overview / filters / category context。
5. sync summary / secondary utilities。
6. diagnostics / advanced settings。

routine sync pending を primary action より強く見せません。conflict / auth / corruption は影響に応じて強調します。

## 3. Grouping

- date / view / zoom / snap を timeline context としてまとめる。
- schedule selection と Inspector action の scope を近接させる。
- local save / Google calendar / sync status を同じ概念 group にする。
- notification / Focus を current execution context に関連付ける。
- destructive action は advanced / danger group に置く。

## 4. Overview vs detail

- 24時間 overview は一日の分布、detail は分単位編集。
- overview が detail と異なる selected / hidden schedule を示さない。
- overview overlap の密度表現が schedule identity を完全に隠さない。
- zoom / scroll / base time の現在状態を示す。

## 5. Typography

- date、time、duration、count、status を tabular number 等で読みやすくする。
- Japanese label と long event title の truncation に detail access を持つ。
- primary / secondary / metadata の size / weight を一貫させる。
- user-selected schedule color に text readability を依存させない。

## 6. Density

- Today は高頻度ツールなので過剰な card / padding を避ける。
- dense でも target、focus、selection、drag handle を維持する。
- empty state では説明を出すが、populated state で毎回 space を占有しない。
- 500 items / many overlaps で warning / selected item が埋もれない。

## 7. Navigation / IA

- Today、Week、Month、List、Templates、Focus、Alarms、Settings の役割を重複させない。
- current location と return path を示す。
- search / filter / count の scope を明確にする。
- diagnostics / raw DB を一般ユーザーの主 navigation に置かない。

## 8. Platform

- macOS traffic-light area / native titlebar と primary action を競合させない。
- Windows titlebar / system menu / scale で clipping しない。
- menu / shortcut / tooltip の表現を OS convention に合わせる。
