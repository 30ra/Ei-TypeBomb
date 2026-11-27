#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    webview::{NewWindowResponse, WebviewWindowBuilder},
    WebviewUrl,
};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let site = "https://ei-typebomb.com/".parse::<tauri::Url>()?;
            let allowed_origin = site.origin();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(site))
                .title("Ei-TypeBomb")
                .initialization_script(include_str!("back.js"))
                .inner_size(1120.0, 780.0)
                .on_navigation(move |url| {
                    url.origin() == allowed_origin
                        || matches!(url.as_str(), "about:blank" | "about:srcdoc")
                        || (url.scheme() == "https"
                            && url.host_str() == Some("challenges.cloudflare.com")
                            && url.port().is_none())
                })
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Ei-TypeBomb");
}
