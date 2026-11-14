//! The app's "are you sure?" as the Mac's own alert (packages/mac/src/lib/native-alert.ts): an
//! NSAlert shown as a sheet from the window's title bar, with the app's icon, the question, what
//! happens, and the buttons laid out and keyed as macOS does (the first is the default, Return;
//! Cancel is Esc; a third goes on the left, like "Don't Save"; a destructive one is red).

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
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSModalResponse, NSWindow};
    use objc2_foundation::NSString;
    use std::sync::Mutex;

    /// Shows the alert as a sheet on `window` and calls `done` with the index of the button pressed.
    pub fn show(window: *mut std::ffi::c_void, title: &str, message: &str, style: &str, buttons: &[AlertButton], done: Box<dyn FnOnce(i64) + Send>) {
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
            if let Some(done) = done.lock().ok().and_then(|mut d| d.take()) {
                done((response - NSAlertFirstButtonReturn) as i64);
            }
        });
        alert.beginSheetModalForWindow_completionHandler(window, Some(&handler));
    }
}

/// Shows an alert and returns the index of the button pressed (in the order given).
#[tauri::command]
pub async fn native_alert(window: tauri::Window, title: String, message: String, style: String, buttons: Vec<AlertButton>) -> Result<i64, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ns = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || {
                mac::show(ns as *mut std::ffi::c_void, &title, &message, &style, &buttons, Box::new(move |i| {
                    let _ = tx.send(i);
                }));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, title, message, style, buttons);
        Err("native alerts are the Mac's".into())
    }
}
