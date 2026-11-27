# Ei-TypeBomb デスクトップ版

Tauri 2 のウィンドウで [Ei-TypeBomb の本番サイト](https://ei-typebomb.com/) を表示します。ゲーム、認証、ルーム管理には公開サービスを利用するため、インターネット接続が必要です。

アプリ内のページ遷移は本番サイトと同じオリジンに限られます。サイトからの別ウィンドウの作成は無効です。

## 起動とビルド

Rust 1.90 以上と、ビルドする OS に対応する [Tauri の前提ツール](https://v2.tauri.app/start/prerequisites/) を用意してください。最新の安定版 Rust を推奨します。リポジトリのルートから実行します。

```sh
cargo install tauri-cli --version '^2' --locked
cd desktop
cargo tauri dev --no-dev-server
cargo tauri build -- --locked
```

`cargo tauri dev` で開発版が起動します。終了してから `cargo tauri build` を実行すると、ビルドを実行した OS 用のパッケージが `desktop/src-tauri/target/release/bundle/` に作成されます。形式は Windows が NSIS、macOS が DMG、Linux が DEB です。
