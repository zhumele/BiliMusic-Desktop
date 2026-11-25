#[tokio::main]
async fn main() {
    if let Err(error) = bilimusic_lib::server::run().await {
        eprintln!("bilimusic-server failed: {error}");
        std::process::exit(1);
    }
}
