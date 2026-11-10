---
name: rust
description: Change Rust code (crates, CLIs, Tauri shells, servers) with cargo — fmt, clippy, tests, ownership and error handling done the idiomatic way, and no unsafe without a written reason.
---

# Rust

Follow `dev-loop`. This adds what is particular to Rust.

## Checks (in this order)

`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` (or the project's lint level),
`cargo test`, and `cargo build --release` once if the change touches release code. In a workspace,
scope with `-p <crate>` while iterating.

## Idioms

- Errors: `Result` everywhere it can fail; `thiserror` for library error types, `anyhow` (or the
  project's choice) in binaries; add context where an error crosses a boundary. No `unwrap()`/`expect()`
  on input from outside; `expect("why this can't fail")` only where it truly can't.
- Ownership: borrow before cloning; clone deliberately, not to quiet the borrow checker. Prefer
  `&str`/`&[T]` in parameters.
- Shared state across threads: `Arc<Mutex<_>>`/`RwLock` or channels; async code doesn't hold a std
  mutex across `.await`.
- `unsafe` only with a `// SAFETY:` comment saying why it holds, and a test.
- Don't add a crate for a few lines; check the license and maintenance of one you do add.

## Build troubles

If proc-macro crates fail with `E0463 can't find crate` on macOS, it can be the toolchain or linker,
not the code: check with a tiny proc-macro project before changing code, and tell the owner.
