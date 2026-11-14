//! A file of yours the Mac's way (packages/mac/src/lib/files.ts): Quick Look (Space, as in
//! Finder) and the Share menu (Messages, Mail, AirDrop…), both macOS's own panels.

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, NSObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};
    use std::cell::RefCell;

    // QLPreviewPanel lives in Quartz (QuickLookUI); nothing else here links it.
    #[link(name = "Quartz", kind = "framework")]
    extern "C" {}

    pub struct Files {
        urls: Vec<Retained<NSURL>>,
    }

    define_class!(
        /// What Quick Look shows: the files asked for, in order.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "BelugaQuickLookSource"]
        #[ivars = Files]
        struct Source;

        impl Source {
            #[unsafe(method(numberOfPreviewItemsInPreviewPanel:))]
            fn count(&self, _panel: &AnyObject) -> isize {
                self.ivars().urls.len() as isize
            }

            #[unsafe(method(previewPanel:previewItemAtIndex:))]
            fn item(&self, _panel: &AnyObject, index: isize) -> *mut AnyObject {
                self.ivars().urls.get(index as usize).map_or(std::ptr::null_mut(), |u| Retained::as_ptr(u) as *mut AnyObject)
            }
        }
    );

    thread_local! {
        // The panel holds its data source weakly: kept here until the next one.
        static SOURCE: RefCell<Option<Retained<Source>>> = const { RefCell::new(None) };
    }

    fn urls(paths: &[String]) -> Vec<Retained<NSURL>> {
        paths.iter().map(|p| NSURL::fileURLWithPath(&NSString::from_str(p))).collect()
    }

    pub fn quick_look(paths: &[String]) -> bool {
        let Some(mtm) = MainThreadMarker::new() else { return false };
        let Some(class) = AnyClass::get(c"QLPreviewPanel") else { return false };
        let source = Source::alloc(mtm).set_ivars(Files { urls: urls(paths) });
        let source: Retained<Source> = unsafe { msg_send![super(source), init] };
        unsafe {
            let panel: *mut AnyObject = msg_send![class, sharedPreviewPanel];
            let Some(panel) = panel.as_ref() else { return false };
            let _: () = msg_send![panel, setDataSource: &*source];
            let _: () = msg_send![panel, reloadData];
            let _: () = msg_send![panel, setCurrentPreviewItemIndex: 0isize];
            let _: () = msg_send![panel, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
        }
        SOURCE.with(|s| *s.borrow_mut() = Some(source));
        true
    }

    /// The Share menu for the files, beside `rect` (the window's points from its top-left).
    pub fn share(view: *mut std::ffi::c_void, paths: &[String], rect: (f64, f64, f64, f64)) -> bool {
        let Some(_mtm) = MainThreadMarker::new() else { return false };
        // SAFETY: the window's own content view, alive while its window is.
        let Some(view) = (unsafe { view.cast::<NSView>().as_ref() }) else { return false };
        let items: Vec<Retained<AnyObject>> = urls(paths).into_iter().map(Retained::into_super).map(Retained::into_super).collect();
        let array = NSArray::from_retained_slice(&items);
        // SAFETY: the items are file URLs, which the picker takes.
        let picker = unsafe { NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &array) };
        let (x, y, w, h) = rect;
        let height = view.frame().size.height;
        let origin = if view.isFlipped() { NSPoint::new(x, y) } else { NSPoint::new(x, height - y - h) };
        picker.showRelativeToRect_ofView_preferredEdge(NSRect::new(origin, NSSize::new(w, h)), view, NSRectEdge::MinY);
        true
    }
}

/// Quick Look on the files (yours, on this Mac): macOS's own panel, as Space in Finder.
#[tauri::command]
pub async fn quick_look(window: tauri::Window, paths: Vec<String>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(mac::quick_look(&paths));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, paths);
        Ok(false)
    }
}

/// The Share menu for the files, beside the rect (x, y, width, height in the window's points).
#[tauri::command]
pub async fn share_files(window: tauri::Window, paths: Vec<String>, x: f64, y: f64, width: f64, height: f64) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let view = window.ns_view().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || {
                let _ = tx.send(mac::share(view as *mut std::ffi::c_void, &paths, (x, y, width, height)));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, paths, x, y, width, height);
        Ok(false)
    }
}
