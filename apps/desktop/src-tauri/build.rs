fn main() {
    println!("cargo:rerun-if-env-changed=DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_ID");
    tauri_build::build()
}
