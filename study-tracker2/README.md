# 📚 学習記録アプリ v2

スマホで操作しやすい学習進捗管理Webアプリ。  
資格試験の過去問・学校の教科書問題に対応。

---

## 🚀 起動方法

```bash
tar xzf study-tracker.tar.gz
cd study-tracker
docker compose up -d
```

ブラウザで http://localhost:8000 を開く。  
スマホからは `http://PCのIPアドレス:8000`

---

## 🔑 使い方

### 1. 題材を追加
「学習」タブ → 「＋ 追加」

- **カテゴリ**：数学・宅建・英語など（省略可、グループ表示に使用）
- **題材名**：2024年度過去問・第3章など
- **問題番号**：
  - 「連番で自動生成」→ 件数を入力（プレフィックスで年度付きも可）
  - 「手動入力」→ 1行1問。`# グループ名` で区切り線を追加
    ```
    # 2022年度
    2022-問1
    2022-問2(1)
    問22-Ⅲ-(3)
    ```

### 2. 学習する
題材カードをタップ → 5回分の表が開く

| 操作 | 動作 |
|------|------|
| セルをタップ | 空欄 → ○ → × → 空欄 |
| 記録時 | 日付が自動保存される |

- 各セルに記録した日付が表示される（後から改ざんしにくい設計）

### 3. 進捗を確認
- カード左の**リングゲージ**：○（正解）の割合
- カード下の**回数ごとの集計**：1回目〜5回目の○×数

### 4. さぼり防止
- 画面上部に**今日の○×数**が常に表示
- **目標問題数**を設定してプログレスバーで可視化
- **連続学習日数（ストリーク）**がヘッダーに表示

### 5. 履歴を確認
「履歴」タブ → 日別の学習量と正答率グラフ

---

## 💾 データ保存

SQLite（`/data/study.db`）に保存。  
Dockerボリューム `study_data` にマウント → コンテナを削除しても記録は残る。

バックアップ：
```bash
docker cp <container_id>:/data/study.db ./backup.db
```

---

## 📁 構成

```
study-tracker/
├── backend/
│   ├── main.py
│   └── requirements.txt
├── frontend/
│   └── index.html
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 🔔 Slack通知（今日タブ進捗を1時間ごと）

`SLACK_WEBHOOK_URL` を設定すると、毎時00分ごろに「今日」タブの進捗（合計 + 各科目の `完了 / 合計 (%)`）をSlackへ送信できます。

```bash
export SLACK_NOTIFY_ENABLED=true
export SLACK_WEBHOOK_URL='https://hooks.slack.com/services/XXX/YYY/ZZZ'
docker compose up -d --build
```

手動テスト送信：

```bash
curl -X POST http://localhost:8000/api/admin/slack/today-notify
```
