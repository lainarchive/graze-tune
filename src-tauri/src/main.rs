#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("--worker") {
        std::process::exit(graze_tune_lib::worker(&args[1..]));
    }
    graze_tune_lib::run()
}
