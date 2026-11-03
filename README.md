# VoiceSync Teleprompter

YouTube動画撮影時にカメラ目線を維持しながら日本語・英語の原稿を自然に読み上げられる、個人利用向けの**リアルタイム音声追従型テレプロンプター** Webアプリケーションです。

- **Web公開URL (GitHub Pages)**: https://katsuhiroendo.github.io/VoiceSync_Teleprompter/
- **詳細仕様書・操作マニュアル**: [`Doc/SPECIFICATION_AND_USAGE.md`](./Doc/SPECIFICATION_AND_USAGE.md)

## 主な特徴

- **リアルタイム音声認識 & ファジー原稿追従**：発話内容を認識し、言い間違い・数秒〜10秒以上の沈黙・飛ばし読み・アドリブ挿入・前の文の読み直しに適応して自動スクロール。
- **カメラ目線モード & フォーカスモード**：MacBook内蔵カメラ直下に表示領域を集約し、現在読んでいるフレーズのみを明るくハイライト表示。
- **完全無料・オフライン耐性 (IndexedDB + PWA)**：すべての原稿データと表示設定をブラウザ内の IndexedDB に自動保存。オフライン時は手動・一定速度スクロールへ自動フォールバック。
- **MacBook ⇄ iPad 原稿同期**：JSONバンドル書き出し/読み込み（AirDrop・iCloud Drive対応）およびRESTエンドポイント双方向同期（同時編集時の競合バックアップ保護付き）。

## クイックスタート（ローカル開発）

```bash
npm install
npm run dev
```

詳細な使い方や設定項目、トラブルシューティングについては [`Doc/SPECIFICATION_AND_USAGE.md`](./Doc/SPECIFICATION_AND_USAGE.md) をご覧ください。
