// ARGUS desktop shell (Theme 4.19) — a thin Tauri window over the Node
// backend. On launch it starts `node server/index.js` (unless something is
// already listening on the backend port), waits for it to come up, and opens
// a window at http://127.0.0.1:<port>/ — the backend serves the built
// frontend statically, so /api and /ws are same-origin and the web app runs
// unmodified. The child is killed on exit. Requires Node on the machine and
// runs from a checkout (the backend + web/dist live next to the executable's
// repo, not inside the installer bundle).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 8787;

fn backend_up() -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], PORT).into(), Duration::from_millis(400)).is_ok()
}

// Walk up from the executable (and cwd as a fallback) until a directory
// containing server/index.js appears — that's the repo root.
fn find_repo_root() -> Option<PathBuf> {
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    for start in starts {
        let mut dir = Some(start.as_path());
        while let Some(d) = dir {
            if d.join("server").join("index.js").is_file() {
                return Some(d.to_path_buf());
            }
            dir = d.parent();
        }
    }
    None
}

fn spawn_backend() -> Option<Child> {
    if backend_up() {
        return None; // dev server (or another shell) already owns the port
    }
    let root = find_repo_root()?;
    Command::new("node")
        .arg("server/index.js")
        .current_dir(root)
        // Watchdog handle: the backend polls this PID and exits if we vanish,
        // covering force-kills where our RunEvent::Exit cleanup never runs.
        .env("ARGUS_PARENT_PID", std::process::id().to_string())
        .spawn()
        .ok()
}

fn main() {
    let backend: Mutex<Option<Child>> = Mutex::new(spawn_backend());

    // Give the backend up to 15 s to bind (ports index + SQLite open take ~1 s).
    let deadline = Instant::now() + Duration::from_secs(15);
    while !backend_up() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
    }

    let app = tauri::Builder::default()
        .setup(move |app| {
            let url = format!("http://127.0.0.1:{PORT}/").parse().unwrap();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("ARGUS — Global Command Center")
                .inner_size(1500.0, 950.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building ARGUS shell");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = backend.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
