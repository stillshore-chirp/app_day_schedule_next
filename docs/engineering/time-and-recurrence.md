# Time and Recurrence Contract

## 1. Types

- `UtcInstant`: absolute point。
- `IanaTimezone`: named timezone。
- `LocalDate`, `LocalTime`, `LocalDateTimeInput`: user intent。
- `MinuteOfDay(0..1439)`。
- `DurationMinutes(1..)`。
- `OffsetChoice`: ambiguous local time の選択。
- `ScheduleInterval`: `[start,end)`。

primitive string / integer を domain 内へそのまま流しません。

## 2. Concrete schedule

UI input を timezone とともに resolve し、UTC instant を保存します。表示時は schedule timezone または selected display timezone へ変換します。

- gap: validation error または explicit resolution choice。
- overlap: first / second occurrence を明示。
- timezone change: instant-preserving change と wall-clock-preserving edit を別操作にする。
- TicketからScheduleへ割り当てる場合も同じresolverを使う。local date/time、所要分、IANA timezone、必要な`OffsetChoice`を受け取り、gapを拒否し、overlapの候補をUIで選択してからScheduleとlinkを確定する。

## 3. Templates / Quick Blocks / Free Alarms

これらは absolute instant ではなく wall-clock intent です。target date と timezone へ適用する時に concrete value を生成します。DST で apply 不能 / ambiguous の場合は preview で示します。

## 4. All-day

- start date inclusive、end date exclusive。
- UTC midnight conversion を persisted truth にしない。
- Google all-day event と date range で round-trip する。

## 5. Recurrence

- RFC 5545 recurrence setを保存し、occurrenceを必要範囲で展開する。DTSTARTは常に集合へ含め、`RRULE` / `RDATE`のunionから`EXDATE` / legacy `EXRULE`をsubtractする。
- primary `RRULE`に加え、追加`RRULE`、parameter付き`RDATE`、legacy `EXRULE`を補助lineとして保持する。`EXDATE`はUTC instantへ正規化する。
- ordinal `BYDAY`、`BYSETPOS`、`WKST`、negative month dayを含むrule partはRFC parserへ委譲し、独自の部分実装で意味を変えない。
- master と exception を identity で関連付ける。
- edit scope: this / this-and-following / series を明示する。
- EXDATE / moved / cancelled occurrence を保持する。
- count / until / timezone の semantic を test する。DST gapで存在しないwall timeは別時刻へ補正せず生成を見送り、overlapは基準offsetを使ったことをwarningにする。
- 補助line 64件、1件2,000文字、EXDATE 10,000件、1回の展開65,534件をhard limitとする。UI previewは最大100件とする。
- `RDATE;VALUE=PERIOD`の可変durationは固定長schedule modelへ変換しない。該当calendarを安全停止し、previous tokenと既存予定を保持する。

## 6. Overlap / current / next

- overlap は positive intersection。
- current は `start <= now < end`。
- next は current snapshot より後の最小 start。過去 recurring occurrence を再選択しない。
- cross-midnight を day segment に分割して layout する。
- overview の5分互換 threshold と detail side-by-side を別 pure function にする。

## 7. Determinism

- `Clock` と timezone database を injection / version awareness で扱う。
- same input / same tzdata で same output。
- test は fixed instant、timezone、locale を使用する。

## 8. Timer / Stopwatch

- timer の設定値は `duration_seconds: 1..=604800` と100文字以内の任意ラベル。複数 timer は独立した `Idle / Running / Paused / Completed` 状態と optimistic version を持つ。
- timer set は timer のラベルと設定時間を順序付きで保存する。適用は単一 transaction で停止状態の timer を追記し、既存 timer と現在の計測を変更しない。
- stopwatch は端末内で1件の `Idle / Running / Paused` 状態を持つ。
- process 内では monotonic anchor から elapsed を求める。再起動後の初回観測では保存済み UTC start と wall clock の非負差を復旧値にし、その後の wall clock jump を elapsed へ反映しない。
- pause / resume / reset / completion は SQLite へ version 付きで確定する。timer completion は run UUID ごとに1回だけ記録する。

## 9. Boundary tests

- adjacent、1分 overlap、4分、5分、multiple components。
- 23:59、00:00、24h、cross-midnight。
- leap day、month end、year end。
- New York / Berlin の gap / overlap。
- Ticket割り当てのgap拒否、overlap選択、23:30からの日跨ぎ、Schedule移動・resize・timezone変更後の予定時間再集計。
- system timezone change。
- all-day multi-day。
- recurrence master / exception / cancellation / until、複数RRULE、RDATE、EXDATE、EXRULE、ordinal BYDAY、BYSETPOS、WKST。
- 複数 timer の並行進行、1秒 / 7日境界、pause / resume、restart recovery、wall clock forward / backward。
- stopwatch の repeated pause / resume、restart recovery、wall clock backward。
