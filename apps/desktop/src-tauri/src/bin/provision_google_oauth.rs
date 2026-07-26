use keyring::Entry;
use serde::Serialize;

const KEYRING_SERVICE: &str = "com.stillshorechirp.dayschedulenext.google";
const KEYRING_USER: &str = "oauth-built-in-client";
const CLIENT_ID_ENV: &str = "DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_ID";
const CLIENT_SECRET_ENV: &str = "DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_SECRET";

#[derive(Serialize)]
struct ProvisionedOAuthClient<'a> {
    client_id: &'a str,
    client_secret: &'a str,
}

fn main() {
    if provision().is_err() {
        eprintln!(
            "Google OAuth資格情報をOS秘密ストアへ登録できませんでした。環境変数とOS秘密ストアを確認してください。"
        );
        std::process::exit(1);
    }
    println!("Google OAuth資格情報をOS秘密ストアへ登録しました。");
}

fn provision() -> Result<(), ()> {
    let client_id = std::env::var(CLIENT_ID_ENV).map_err(|_| ())?;
    let client_secret = std::env::var(CLIENT_SECRET_ENV).map_err(|_| ())?;
    if !valid_client_id(&client_id) || !valid_client_secret(&client_secret) {
        return Err(());
    }
    let credential = serde_json::to_string(&ProvisionedOAuthClient {
        client_id: &client_id,
        client_secret: &client_secret,
    })
    .map_err(|_| ())?;
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.set_password(&credential))
        .map_err(|_| ())
}

fn valid_client_id(value: &str) -> bool {
    (30..=500).contains(&value.len())
        && value.ends_with(".apps.googleusercontent.com")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_'))
}

fn valid_client_secret(value: &str) -> bool {
    (8..=2_000).contains(&value.len())
        && value.trim() == value
        && !value.bytes().any(|byte| byte.is_ascii_control())
}

#[cfg(test)]
mod tests {
    use super::{valid_client_id, valid_client_secret};

    #[test]
    fn validates_google_desktop_client_credentials_without_echoing_them() {
        assert!(valid_client_id(
            "synthetic-client.apps.googleusercontent.com"
        ));
        assert!(!valid_client_id("synthetic-project-id"));
        assert!(valid_client_secret("synthetic-client-secret"));
        assert!(!valid_client_secret(" "));
    }
}
