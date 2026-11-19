//! The app's "are you sure?" as the Mac's own alert (packages/mac/src/lib/native-alert.ts): an
//! NSAlert shown as a sheet from the window's title bar, with the app's icon, the question, what
//! happens, and the buttons laid out and keyed as macOS does (the first is the default, Return;
//! Cancel is Esc; a third goes on the left, like "Don't Save"; a destructive one is red).

// Only a Mac shows these: elsewhere each command says no, and the types it would read go unused.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertButton {
    label: String,
    #[serde(default)]
    destructive: bool,
    /// Esc presses it (the Cancel button, whatever its words in this language).
    #[serde(default)]
    cancel: bool,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::AlertButton;
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2::rc::Retained;
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSModalResponse, NSWindow};
    use objc2_foundation::NSString;
    use std::cell::RefCell;
    use std::sync::Mutex;

    /// The alert up now: its token (the page's), the alert and the window it's a sheet on.
    type Shown = (u64, Retained<NSAlert>, Retained<NSWindow>);

    thread_local! {
        static SHOWN: RefCell<Option<Shown>> = const { RefCell::new(None) };
    }

    /// Takes the alert `token` down (its page went: Esc, another sheet), as if cancelled.
    pub fn close(token: u64) {
        let shown = SHOWN.with(|s| s.try_borrow_mut().ok().and_then(|mut s| if s.as_ref().is_some_and(|(t, ..)| *t == token) { s.take() } else { None }));
        if let Some((_, alert, window)) = shown {
            window.endSheet(&alert.window());
        }
    }

    /// Shows the alert as a sheet on `window` and calls `done` with the index of the button pressed.
    pub fn show(window: *mut std::ffi::c_void, token: u64, title: &str, message: &str, style: &str, buttons: &[AlertButton], done: Box<dyn FnOnce(i64) + Send>) {
        let Some(mtm) = MainThreadMarker::new() else { return done(-1) };
        // SAFETY: the app's own window, alive while it's open.
        let Some(window) = (unsafe { window.cast::<NSWindow>().as_ref() }) else { return done(-1) };
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str(title));
        alert.setInformativeText(&NSString::from_str(message));
        alert.setAlertStyle(match style {
            "info" => NSAlertStyle::Informational,
            _ => NSAlertStyle::Warning,
        });
        for button in buttons {
            let b = alert.addButtonWithTitle(&NSString::from_str(&button.label));
            let obj: &AnyObject = b.as_ref();
            if button.destructive && unsafe { msg_send![obj, respondsToSelector: sel!(setHasDestructiveAction:)] } {
                b.setHasDestructiveAction(true);
            }
            if button.cancel {
                b.setKeyEquivalent(&NSString::from_str("\u{1b}"));
            }
        }
        let done = Mutex::new(Some(done));
        let handler = RcBlock::new(move |response: NSModalResponse| {
            SHOWN.with(|s| {
                if let Ok(mut s) = s.try_borrow_mut() {
                    if s.as_ref().is_some_and(|(t, ..)| *t == token) {
                        s.take();
                    }
                }
            });
            if let Some(done) = done.lock().ok().and_then(|mut d| d.take()) {
                done((response - NSAlertFirstButtonReturn) as i64);
            }
        });
        // SAFETY: the window is alive (it was just read on this thread); kept with the alert so close can end it.
        let kept: Retained<NSWindow> = unsafe { Retained::retain(window as *const NSWindow as *mut NSWindow) }.expect("window");
        SHOWN.with(|s| {
            if let Ok(mut s) = s.try_borrow_mut() {
                *s = Some((token, alert.clone(), kept));
            }
        });
        alert.beginSheetModalForWindow_completionHandler(window, Some(&handler));
    }
}

/// Shows an alert and returns the index of the button pressed (in the order given).
#[tauri::command]
pub async fn native_alert(window: tauri::Window, token: u64, title: String, message: String, style: String, buttons: Vec<AlertButton>) -> Result<i64, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let on = window.clone();
        window
            .run_on_main_thread(move || {
                // The window's pointer, read here on the main thread, where it's used.
                let ns = on.ns_window().unwrap_or(std::ptr::null_mut());
                mac::show(ns, token, &title, &message, &style, &buttons, Box::new(move |i| {
                    let _ = tx.send(i);
                }));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, token, title, message, style, buttons);
        Err("native alerts are the Mac's".into())
    }
}

/// Takes the alert `token` down: the page that asked is gone.
#[tauri::command]
pub async fn native_alert_close(window: tauri::Window, token: u64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window.run_on_main_thread(move || mac::close(token)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (window, token);
    Ok(())
}
