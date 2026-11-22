//! Writes the built-in catalog as JSON for the browser preview: `cargo run -p graze-engine --example export_catalog > src/data/catalog.json`
fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "{}",
        serde_json::to_string(&graze_engine::Catalog::builtin()?)?
    );
    Ok(())
}
