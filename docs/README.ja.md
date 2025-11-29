
<img src="./images/1131.png" width = "405" height = "511" alt="NapCat" align=right />

<div align="center">

# Firefly

**[简体中文](../README.md)** | **[English](../README.en.md)** | **[日本語](README.ja.md)** | **[繁體中文](README.zh-TW.md)** | **[Русский](README.ru.md)**

> 美しくモダンな Astro ブログテーマテンプレート
> 
> ![Node.js >= 20](https://img.shields.io/badge/node.js-%3E%3D20-brightgreen) 
![pnpm >= 9](https://img.shields.io/badge/pnpm-%3E%3D9-blue)
![Astro](https://img.shields.io/badge/Astro-5.16.2-orange)
</div>


---
🚀 クイックガイド：
[**🖥️ライブデモ**](https://firefly.cuteleaf.cn/) /
[**📝ドキュメント**](https://docs-firefly.cuteleaf.cn/) /
[**🍀私のブログ**](https://blog.cuteleaf.cn)

📖 README：
**[简体中文](../README.md)** | **[English](../README.en.md)** | **[日本語](README.ja.md)** | **[繁體中文](README.zh-TW.md)** | **[Русский](README.ru.md)** 

⚡ 静的サイト生成：Astroベースの超高速読み込み速度とSEO最適化

🎨 モダンデザイン：シンプルで美しいインターフェース、カスタマイズ可能なテーマカラー

📱 モバイルフレンドリー：完璧なレスポンシブ体験、モバイル専用最適化

🔧 高度にカスタマイズ可能：ほとんどの機能モジュールは設定ファイルでカスタマイズ可能

<img alt="firefly" src="./images/1.webp" />

>[!TIP]
>重要なレイアウトでは、Fireflyは革新的に左右のデュアルサイドバー、記事グリッド（2列）レイアウトを追加し、
>
>サイト統計、カレンダーコンポーネント、記事目次などの小さなウィジェットを追加してサイドバーをより豊かにし、
>
>同時にFurwaiのレイアウトシステムも保持しており、設定ファイルで自由に切り替えられます。
>
>**レイアウト設定とデモの詳細については、[Fireflyレイアウトシステム詳細](https://firefly.cuteleaf.cn/posts/firefly-layout-system/)をご覧ください**

## ✨ 機能

### コア機能

- [x] **Astro + Tailwind CSS** - モダンな技術スタックベースの超高速静的サイト生成
- [x] **スムーズなアニメーション** - Swupページトランジションアニメーションで滑らかなブラウジング体験
- [x] **レスポンシブデザイン** - デスクトップ、タブレット、モバイルデバイスに完璧に対応
- [x] **多言語サポート** - i18n国際化、簡体字中国語、繁体字中国語、英語、日本語、ロシア語をサポート
- [x] **全文検索** - Pagefindベースのクライアントサイド検索、記事コンテンツのインデックスをサポート。MeiliSearch検索エンジンもサポート

### パーソナライゼーション
- [x] **サイドバー** - シングルサイドバー、デュアルサイドバー設定をサポート、フロントエンドで自由に切り替え可能
- [x] **記事レイアウト** - リスト（単列）、グリッド（2列）レイアウトをサポート、フロントエンドで自由に切り替え可能
- [x] **フォント管理** - カスタムフォントをサポート、豊富なフォントセレクター
- [x] **フッター設定** - HTMLコンテンツ注入、完全カスタマイズ可能
- [x] **ナビゲーションバーのカスタマイズ** - ロゴ、タイトル、リンクを完全カスタマイズ
- [x] **壁紙モード切り替え** - バナー壁紙、フルスクリーン壁紙、単色背景、フロントエンドで自由に切り替え可能
- [x] **テーマカラーのカスタマイズ** - 360°色相調整、ライト/ダーク/システム追従の3モードをサポート、フロントエンドで自由に切り替え可能

### ページコンポーネント
- [x] **ゲストブック** - ゲストブックページをサポート、コメントシステム統合
- [x] **お知らせバー** - トップお知らせ通知、閉じる機能とカスタムスタイルをサポート
- [x] **マスコット** - SpineとLive2Dの2つのアニメーションエンジンをサポート
- [x] **サイト統計** - 記事、カテゴリ、タグ数、総文字数、稼働時間、最終更新時刻を表示
- [x] **サイトカレンダー** - 今月のカレンダーと今月公開された記事を表示
- [x] **スポンサーページ** - 複数の支払い方法、支払いQRコード、スポンサーリスト、記事内スポンサーボタン
- [x] **桜エフェクト** - 桜エフェクトをサポート、フルスクリーン桜アニメーション
- [x] **友人リンク** - 美しい友人リンク表示カード
- [x] **広告コンポーネント** - カスタムサイドバー広告コンテンツをサポート
- [x] **Bangumi** - Bangumi APIベースのアニメとゲーム記録表示
- [x] **コメントシステム** - Twikoo、Waline、Giscus、Disqus、Artalkコメントシステムを統合
- [x] **訪問者数統計** - Waline、Twikoo組み込みの訪問追跡を呼び出し可能
- [x] **音楽プレーヤー** - APlayerベース、ローカル音楽とMeting APIオンライン音楽をサポート

### コンテンツ拡張
- [x] **画像ライトボックス** - Fancybox画像プレビュー機能
- [x] **フローティング目次** - 記事の目次を動的に表示、アンカージャンプをサポート、サイドバー目次非表示時に表示
- [x] **サイドバー目次** - 記事の目次を動的に表示、アンカージャンプをサポート
- [x] **強化されたコードブロック** - Expressive Codeベース、コード折りたたみ、行番号、言語識別をサポート
- [x] **数式サポート** - KaTeXレンダリングエンジン、インラインとブロック数式をサポート
- [x] **Markdown拡張** - [Markdown拡張機能](https://github.com/saicaca/fuwari?tab=readme-ov-file#-markdown-extended-syntax)
- [x] **ランダムカバー画像** - APIを介してランダムカバー画像の取得をサポート

### SEO
- [x] **SEO最適化** - 完全なメタタグと構造化データ
- [x] **RSS購読** - RSSフィードを自動生成
- [x] **サイトマップ** - XMLサイトマップを自動生成、ページフィルタリング設定をサポート


## 📝 予定...

- [ ] **Live2Dマスコットのリファクタリング**
- [ ] **グリッドレイアウトの記事カバーの最適化**
- [ ] **アニメーションの滑らかさの継続的な最適化**
- [ ] より多くの機能が継続的に改善中...

便利な機能や最適化があれば、[Pull Request](https://github.com/CuteLeaf/Firefly/pulls)を提出してください

## 🚀 クイックスタート

### 環境要件

- Node.js ≤ 22
- pnpm ≤ 9

### ローカル開発

1. **リポジトリのクローン：**
   ```bash
   git clone https://github.com/Cuteleaf/Firefly.git
   cd Firefly
   ```
   **まず自分のリポジトリに[Fork](https://github.com/CuteLeaf/Firefly/fork)してからクローン（推奨）**
   ```bash
   git clone https://github.com/you-github-name/Firefly.git
   cd Firefly
   ```
3. **依存関係のインストール：**
   ```bash
   # pnpmがインストールされていない場合、まずインストール
   npm install -g pnpm
   
   # プロジェクトの依存関係をインストール
   pnpm install
   ```

4. **ブログの設定：**
   - `src/config/`ディレクトリ内の設定ファイルを編集してブログをカスタマイズ

5. **開発サーバーの起動：**
   ```bash
   pnpm dev
   ```
   ブログは`http://localhost:4321`で利用可能になります

### プラットフォームホスティングデプロイ
- **[公式ガイド](https://docs.astro.build/ja/guides/deploy/)を参照して、Vercel、Netlify、GitHub Pages、Cloudflare Pages、EdgeOne Pagesなどにブログをデプロイしてください。**

   フレームワークプリセット： `Astro`

   ルートディレクトリ： `./`

   出力ディレクトリ： `dist`

   ビルドコマンド： `pnpm run build`

   インストールコマンド： `pnpm install`

## 📖 設定説明

> 📚 **詳細な設定ドキュメント**：[Fireflyドキュメント](https://docs-firefly.cuteleaf.cn/)で完全な設定ガイドを確認してください

### ウェブサイトの言語設定

ブログのデフォルト言語を設定するには、`src/config/siteConfig.ts`ファイルを編集します：

```typescript
// サイト言語を定義
const SITE_LANG = "zh_CN";
```

**サポートされている言語コード：**
- `zh_CN` - 簡体字中国語
- `zh_TW` - 繁体字中国語
- `en` - 英語
- `ja` - 日本語
- `ru` - ロシア語


### 設定ファイル構造

```
src/
├── config/
│   ├── index.ts              # 設定インデックスファイル
│   ├── siteConfig.ts         # サイト基本設定
│   ├── profileConfig.ts      # ユーザープロフィール設定
│   ├── commentConfig.ts      # コメントシステム設定
│   ├── announcementConfig.ts # お知らせ設定
│   ├── licenseConfig.ts      # ライセンス設定
│   ├── footerConfig.ts       # フッター設定
│   ├── FooterConfig.html     # フッターHTMLコンテンツ
│   ├── expressiveCodeConfig.ts # コードハイライト設定
│   ├── sakuraConfig.ts       # 桜エフェクト設定
│   ├── fontConfig.ts         # フォント設定
│   ├── sidebarConfig.ts      # サイドバーレイアウト設定
│   ├── navBarConfig.ts       # ナビゲーションバー設定
│   ├── musicConfig.ts        # 音楽プレーヤー設定
│   ├── pioConfig.ts          # マスコット設定
│   ├── adConfig.ts           # 広告設定
│   ├── friendsConfig.ts      # 友人リンク設定
│   ├── sponsorConfig.ts      # スポンサー設定
│   └── coverImageConfig.ts   # 記事ランダムカバー画像設定
```


## ⚙️ 記事のFrontmatter

```yaml
---
title: My First Blog Post
published: 2023-09-09
description: This is the first post of my new Astro blog.
image: ./cover.jpg  # または「api」を使用してランダムカバー画像を有効化
tags: [Foo, Bar]
category: Front-end
draft: false
lang: zh-CN      # 記事の言語が`siteConfig.ts`のサイト言語と異なる場合のみ設定
---
```

## 🧞 コマンド

すべてのコマンドはプロジェクトルートディレクトリで実行する必要があります：

| Command                           | Action                            |
|:----------------------------------|:----------------------------------|
| `pnpm install`と`pnpm add sharp` | 依存関係をインストール                              |
| `pnpm dev`                        | `localhost:4321`でローカル開発サーバーを起動      |
| `pnpm build`                      | `./dist/`にサイトをビルド                   |
| `pnpm preview`                    | ビルドされたサイトをローカルでプレビュー                        |
| `pnpm new-post <filename>`        | 新しい記事を作成                             |
| `pnpm astro ...`                  | `astro add`、`astro check`などのコマンドを実行 |
| `pnpm astro --help`               | Astro CLIヘルプを表示                   |

## 🙏 謝辞

- [Fuwari](https://github.com/saicaca/fuwari)テンプレートを開発した[saicaca](https://github.com/saicaca)に深く感謝します。Fireflyはこのテンプレートをベースに開発されています
- ブロガー[霞葉](https://kasuha.com)の[Bangumiコレクション表示ページソリューション](https://kasuha.com/posts/fuwari-enhance-ep2/)を参考にしました
- [Mizuki](https://github.com/matsuzaka-yuki/Mizuki)のバナータイトル/多階層メニューナビゲーションバー/桜エフェクト/KaTeX/Fancyboxソリューションを参考にしました
- [Astro](https://astro.build)と[Tailwind CSS](https://tailwindcss.com)を使用して構築
- [MetingJS](https://github.com/metowolf/MetingJS)と[APlayer](https://github.com/MoePlayer/APlayer)音楽プレーヤーを使用
- Bilibili UP主[公公的日常](https://space.bilibili.com/3546750017080050)が提供するQ版`蛍`マスコットスライスデータモデルを使用
- アイコンは[Iconify](https://iconify.design/)から
- 蛍関連の画像素材の著作権はゲーム[「崩壊：スターレイル」](https://sr.mihoyo.com/)の開発元[miHoYo](https://www.mihoyo.com/)に帰属します。

## 🍀 貢献者

このプロジェクトに貢献してくれた以下の貢献者に感謝します。質問や提案がある場合は、[Issue](https://github.com/CuteLeaf/Firefly/issues)または[Pull Request](https://github.com/CuteLeaf/Firefly/pulls)を提出してください。

<a href="https://github.com/CuteLeaf/Firefly/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=CuteLeaf/Firefly" />
</a>

![Alt](https://repobeats.axiom.co/api/embed/6139639d8e88da4d3dc9d45fd43f4e4b2d580086.svg "Repobeats analytics image")

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=CuteLeaf/Firefly&type=Date)](https://star-history.com/#CuteLeaf/Firefly&Date)


<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
