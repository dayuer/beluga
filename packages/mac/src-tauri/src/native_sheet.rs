//! A form sheet as the Mac's own (packages/mac/src/lib/native-sheet.ts): an NSPanel slid down from
//! the window's title bar, laid out as AppKit's sheets are (a bold title, its line, labels on the
//! right of their column ending in a colon, the default button on the right), every control the
//! system's: text fields and a text view, pop-up buttons, segmented controls, checkboxes, a
//! disclosure triangle.
//!
//! The page keeps the form's state (React): it sends the whole form (`SheetSpec`) when it opens
//! and again whenever something changes, and hears back each change as a `native-sheet` event.
//! Controls whose form is the same are updated where they are (the caret stays put); a form whose
//! rows changed is built again. "@" in a text view completes a teammate's handle (the system's own
//! completion list) and the handles it knows are drawn in the accent colour.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetOption {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub icon: Option<Vec<u8>>,
    #[serde(default)]
    pub template: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub handle: String,
}

/// One row of the form. `label` puts it in the label column; `hint` is a line under its control.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SheetRow {
    #[serde(rename = "textarea")]
    TextArea {
        id: String,
        value: String,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        lines: Option<u32>,
        #[serde(default)]
        mentions: Vec<Mention>,
        #[serde(default)]
        focus: bool,
    },
    #[serde(rename = "text")]
    Text {
        id: String,
        #[serde(default)]
        label: Option<String>,
        value: String,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        hint: Option<String>,
        #[serde(default)]
        focus: bool,
    },
    #[serde(rename = "note")]
    Note { text: String },
    #[serde(rename = "disclosure")]
    Disclosure { id: String, label: String, open: bool },
    #[serde(rename = "popup")]
    Popup {
        id: String,
        label: String,
        value: String,
        options: Vec<SheetOption>,
        #[serde(default)]
        hint: Option<String>,
    },
    #[serde(rename = "segmented")]
    Segmented {
        id: String,
        label: String,
        value: String,
        options: Vec<SheetOption>,
        #[serde(default)]
        hint: Option<String>,
        #[serde(default)]
        disabled: bool,
    },
}

impl SheetRow {
    /// What a row is, for telling whether the form's rows changed (then it's built again).
    fn shape(&self) -> String {
        match self {
            SheetRow::TextArea { id, .. } => format!("textarea:{id}"),
            SheetRow::Text { id, label, .. } => format!("text:{id}:{}", label.is_some()),
            SheetRow::Note { .. } => "note".into(),
            SheetRow::Disclosure { id, .. } => format!("disclosure:{id}"),
            SheetRow::Popup { id, .. } => format!("popup:{id}"),
            SheetRow::Segmented { id, options, .. } => format!("segmented:{id}:{}", options.len()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FooterCheck {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub detail: Option<String>,
    pub checked: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetSpec {
    pub title: String,
    #[serde(default)]
    pub intro: Option<String>,
    pub rows: Vec<SheetRow>,
    #[serde(default)]
    pub footer: Option<FooterCheck>,
    pub cancel: String,
    pub submit: String,
    pub can_submit: bool,
    #[serde(default)]
    pub busy: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
}

/// What the sheet says back to the page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SheetEvent {
    #[serde(rename = "change")]
    Change { id: String, value: String },
    #[serde(rename = "submit")]
    Submit,
    #[serde(rename = "cancel")]
    Cancel,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{SheetEvent, SheetOption, SheetRow, SheetSpec};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject, Sel};
    use objc2::{define_class, msg_send, sel, AllocAnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSBackingStoreType, NSBezelStyle, NSBorderType, NSButton, NSButtonType, NSColor, NSControl, NSControlStateValueOff, NSControlStateValueOn, NSControlTextEditingDelegate, NSFont,
        NSForegroundColorAttributeName, NSImage, NSPanel, NSPopUpButton, NSScrollView, NSSegmentSwitchTracking, NSSegmentedControl, NSTextAlignment, NSTextDelegate, NSTextField,
        NSTextFieldDelegate, NSTextView, NSTextViewDelegate, NSView, NSWindow, NSWindowStyleMask,
    };
    use objc2_foundation::{NSArray, NSData, NSNotification, NSPoint, NSRange, NSRect, NSSize, NSString};
    use std::cell::RefCell;

    const MARGIN: f64 = 20.0;
    const GAP: f64 = 10.0;
    const LABEL_GAP: f64 = 8.0;

    /// A control of a row, to read and update it.
    enum Control {
        TextArea { scroll: Retained<NSScrollView>, view: Retained<MentionView>, handles: Vec<String> },
        Text { field: Retained<NSTextField> },
        Note,
        Disclosure { triangle: Retained<NSButton>, title: Retained<NSButton> },
        Popup { button: Retained<NSPopUpButton>, values: Vec<String>, options: Vec<SheetOption> },
        Segmented { control: Retained<NSSegmentedControl>, values: Vec<String> },
    }

    struct Row {
        id: String,
        label: Option<Retained<NSTextField>>,
        control: Control,
        /// The note's own text, or the hint under the control.
        line: Option<Retained<NSTextField>>,
    }

    struct Sheet {
        parent: Retained<NSWindow>,
        panel: Retained<NSPanel>,
        root: Retained<Flipped>,
        controller: Retained<Controller>,
        spec: SheetSpec,
        shape: Vec<String>,
        title: Retained<NSTextField>,
        intro: Retained<NSTextField>,
        rows: Vec<Row>,
        footer: Option<(Retained<NSButton>, Option<Retained<NSTextField>>)>,
        error: Retained<NSTextField>,
        cancel: Retained<NSButton>,
        submit: Retained<NSButton>,
        submit_cmd: Retained<NSButton>,
        emit: Box<dyn Fn(SheetEvent)>,
    }

    thread_local! {
        static SHEET: RefCell<Option<Sheet>> = const { RefCell::new(None) };
    }

    fn emit(event: SheetEvent) {
        // Read the callback out first: the page's answer comes back later, never inside this call.
        let call = SHEET.with(|s| s.borrow().as_ref().map(|s| s.emit.as_ref() as *const dyn Fn(SheetEvent)));
        if let Some(call) = call {
            // SAFETY: the sheet (and its callback) lives until close(), which runs on this thread later.
            unsafe { (*call)(event) };
        }
    }

    define_class!(
        /// The sheet's content: laid out from the top, as a form reads.
        #[unsafe(super(NSView))]
        #[thread_kind = MainThreadOnly]
        #[name = "BelugaSheetContent"]
        struct Flipped;

        impl Flipped {
            #[unsafe(method(isFlipped))]
            fn is_flipped(&self) -> bool {
                true
            }
        }
    );

    define_class!(
        /// A text view where "@" completes a handle: the completion's word starts at the "@".
        #[unsafe(super(NSTextView))]
        #[thread_kind = MainThreadOnly]
        #[name = "BelugaMentionTextView"]
        struct MentionView;

        impl MentionView {
            #[unsafe(method(rangeForUserCompletion))]
            fn range_for_completion(&self) -> NSRange {
                match mention_before_caret(self) {
                    Some(range) => range,
                    None => unsafe { msg_send![super(self), rangeForUserCompletion] },
                }
            }
        }
    );

    /// The "@word" just before the caret, if the caret is at the end of one.
    fn mention_before_caret(view: &NSTextView) -> Option<NSRange> {
        let text = view.string();
        let caret = view.selectedRange();
        if caret.length != 0 {
            return None;
        }
        let mut start = caret.location;
        while start > 0 {
            let c = text.characterAtIndex(start - 1);
            if c == u16::from(b'@') {
                return Some(NSRange::new(start - 1, caret.location - (start - 1)));
            }
            if c == u16::from(b' ') || c == u16::from(b'\n') || c == u16::from(b'\t') {
                return None;
            }
            start -= 1;
        }
        None
    }

    define_class!(
        /// Every control's target and the text views' and fields' delegate.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "BelugaSheetController"]
        struct Controller;

        impl Controller {
            #[unsafe(method(changed:))]
            fn changed(&self, sender: &NSControl) {
                if let Some(event) = change_of(sender) {
                    emit(event);
                }
            }

            #[unsafe(method(submit:))]
            fn submit(&self, _sender: &AnyObject) {
                let ok = SHEET.with(|s| s.borrow().as_ref().is_some_and(|s| s.spec.can_submit && !s.spec.busy));
                if ok {
                    emit(SheetEvent::Submit);
                }
            }

            #[unsafe(method(cancel:))]
            fn cancel(&self, _sender: &AnyObject) {
                emit(SheetEvent::Cancel);
            }
        }

        unsafe impl NSObjectProtocol for Controller {}

        unsafe impl NSControlTextEditingDelegate for Controller {
            #[unsafe(method(controlTextDidChange:))]
            fn control_text_did_change(&self, note: &NSNotification) {
                let Some(object) = note.object() else { return };
                let id = SHEET.with(|s| {
                    s.borrow().as_ref().and_then(|s| {
                        s.rows.iter().find_map(|r| match &r.control {
                            Control::Text { field } if std::ptr::eq(Retained::as_ptr(field) as *const AnyObject, Retained::as_ptr(&object) as *const AnyObject) => Some((r.id.clone(), field.stringValue().to_string())),
                            _ => None,
                        })
                    })
                });
                if let Some((id, value)) = id {
                    emit(SheetEvent::Change { id, value });
                }
            }
        }

        unsafe impl NSTextFieldDelegate for Controller {}

        unsafe impl NSTextDelegate for Controller {
            #[unsafe(method(textDidChange:))]
            fn text_did_change(&self, note: &NSNotification) {
                let Some(object) = note.object() else { return };
                let found = SHEET.with(|s| {
                    s.borrow().as_ref().and_then(|s| {
                        s.rows.iter().find_map(|r| match &r.control {
                            Control::TextArea { view, handles, .. } if std::ptr::eq(Retained::as_ptr(view) as *const AnyObject, Retained::as_ptr(&object) as *const AnyObject) => {
                                Some((r.id.clone(), view.clone(), handles.clone()))
                            }
                            _ => None,
                        })
                    })
                });
                let Some((id, view, handles)) = found else { return };
                paint_mentions(&view, &handles);
                // Typing after "@": the system's completion list, of the handles that fit.
                if !handles.is_empty() && mention_before_caret(&view).is_some() {
                    unsafe {
                        let _: () = msg_send![&*view, performSelector: sel!(complete:), withObject: std::ptr::null::<AnyObject>(), afterDelay: 0.0f64];
                    }
                }
                emit(SheetEvent::Change { id, value: view.string().to_string() });
            }
        }

        unsafe impl NSTextViewDelegate for Controller {
            #[unsafe(method_id(textView:completions:forPartialWordRange:indexOfSelectedItem:))]
            fn completions(&self, view: &NSTextView, _words: &NSArray<NSString>, range: NSRange, index: *mut isize) -> Retained<NSArray<NSString>> {
                let text = view.string();
                let typed = text.substringWithRange(range).to_string().to_lowercase();
                let handles = SHEET.with(|s| {
                    s.borrow().as_ref().map(|s| {
                        s.rows.iter().flat_map(|r| match &r.control {
                            Control::TextArea { handles, .. } => handles.clone(),
                            _ => vec![],
                        }).collect::<Vec<_>>()
                    })
                }).unwrap_or_default();
                let fits: Vec<Retained<NSString>> = handles.iter().filter(|h| typed.starts_with('@') && h.to_lowercase().starts_with(&typed)).map(|h| NSString::from_str(&format!("{h} "))).collect();
                if !index.is_null() {
                    unsafe { *index = 0 };
                }
                NSArray::from_retained_slice(&fits)
            }
        }
    );

    /// Where `needle` starts at byte `start` of `text`, compared without case: its end, else None.
    /// Char by char on the text itself, so its byte offsets stay the text's own.
    pub(super) fn match_at(text: &str, start: usize, needle: &str) -> Option<usize> {
        let mut want = needle.chars().flat_map(char::to_lowercase).peekable();
        let mut end = start;
        for (i, c) in text[start..].char_indices() {
            if want.peek().is_none() {
                break;
            }
            for lc in c.to_lowercase() {
                if want.next() != Some(lc) {
                    return None;
                }
            }
            end = start + i + c.len_utf8();
        }
        want.peek().is_none().then_some(end)
    }

    /// The handles it knows, in the accent colour; the rest in the text colour.
    fn paint_mentions(view: &NSTextView, handles: &[String]) {
        let Some(storage) = (unsafe { view.textStorage() }) else { return };
        let text = view.string().to_string();
        let length = view.string().length();
        storage.beginEditing();
        unsafe { storage.addAttribute_value_range(NSForegroundColorAttributeName, &NSColor::textColor(), NSRange::new(0, length)) };
        for (start, c) in text.char_indices() {
            if c != '@' {
                continue;
            }
            for handle in handles {
                let Some(end) = match_at(&text, start, handle) else { continue };
                // Only a whole handle: what follows isn't part of a name.
                if text[end..].chars().next().is_some_and(|n| n.is_alphanumeric() || n == '-' || n == '_') {
                    continue;
                }
                let from = text[..start].encode_utf16().count();
                let len = text[start..end].encode_utf16().count();
                unsafe { storage.addAttribute_value_range(NSForegroundColorAttributeName, &NSColor::controlAccentColor(), NSRange::new(from, len)) };
                break;
            }
        }
        storage.endEditing();
    }

    /// The change a control's action stands for.
    fn change_of(sender: &NSControl) -> Option<SheetEvent> {
        let tag = sender.tag();
        SHEET.with(|s| {
            let s = s.borrow();
            let s = s.as_ref()?;
            if tag == FOOTER_TAG {
                let (check, _) = s.footer.as_ref()?;
                let id = s.spec.footer.as_ref()?.id.clone();
                return Some(SheetEvent::Change { id, value: (check.state() == NSControlStateValueOn).to_string() });
            }
            let row = s.rows.get(tag as usize)?;
            let value = match &row.control {
                Control::Popup { button, values, .. } => values.get(button.indexOfSelectedItem() as usize)?.clone(),
                Control::Segmented { control, values } => values.get(control.selectedSegment() as usize)?.clone(),
                Control::Disclosure { .. } => {
                    let open = s.spec.rows.get(tag as usize).is_some_and(|r| matches!(r, SheetRow::Disclosure { open: true, .. }));
                    (!open).to_string()
                }
                _ => return None,
            };
            Some(SheetEvent::Change { id: row.id.clone(), value })
        })
    }

    const FOOTER_TAG: isize = 10_000;

    fn label(text: &str, mtm: MainThreadMarker) -> Retained<NSTextField> {
        NSTextField::labelWithString(&NSString::from_str(text), mtm)
    }

    fn wrapping(text: &str, size: f64, secondary: bool, mtm: MainThreadMarker) -> Retained<NSTextField> {
        let field = NSTextField::wrappingLabelWithString(&NSString::from_str(text), mtm);
        field.setFont(Some(&NSFont::systemFontOfSize(size)));
        if secondary {
            field.setTextColor(Some(&NSColor::secondaryLabelColor()));
        }
        field.setSelectable(false);
        field
    }

    fn image(png: &[u8], template: bool) -> Option<Retained<NSImage>> {
        let data = NSData::with_bytes(png);
        let image = NSImage::initWithData(NSImage::alloc(), &data)?;
        image.setSize(NSSize::new(14.0, 14.0));
        image.setTemplate(template);
        Some(image)
    }

    unsafe fn target(control: &NSControl, controller: &Controller, action: Sel, tag: isize) {
        unsafe {
            control.setTarget(Some(controller));
            control.setAction(Some(action));
        }
        control.setTag(tag);
    }

    fn fill_popup(button: &NSPopUpButton, options: &[SheetOption], value: &str) {
        button.removeAllItems();
        for option in options {
            button.addItemWithTitle(&NSString::from_str(&option.label));
            if let (Some(png), Some(item)) = (option.icon.as_deref(), button.lastItem()) {
                item.setImage(image(png, option.template.unwrap_or(true)).as_deref());
            }
        }
        if let Some(at) = options.iter().position(|o| o.value == value) {
            button.selectItemAtIndex(at as isize);
        }
        button.sizeToFit();
    }

    fn fill_segments(control: &NSSegmentedControl, options: &[SheetOption], value: &str) {
        control.setSegmentCount(options.len() as isize);
        for (i, option) in options.iter().enumerate() {
            control.setLabel_forSegment(&NSString::from_str(&option.label), i as isize);
            let picture = option.icon.as_deref().and_then(|png| image(png, option.template.unwrap_or(true)));
            control.setImage_forSegment(picture.as_deref(), i as isize);
        }
        if let Some(at) = options.iter().position(|o| o.value == value) {
            control.setSelectedSegment(at as isize);
        }
        control.sizeToFit();
    }

    /// Makes the rows' controls (the form's shape changed, or it's new).
    fn build_rows(spec: &SheetSpec, root: &Flipped, controller: &Controller, mtm: MainThreadMarker) -> Vec<Row> {
        let mut rows = Vec::new();
        for (i, row) in spec.rows.iter().enumerate() {
            let tag = i as isize;
            let built = match row {
                SheetRow::TextArea { id, value, placeholder, mentions, .. } => {
                    let scroll = NSScrollView::initWithFrame(NSScrollView::alloc(mtm), NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(100.0, 80.0)));
                    scroll.setHasVerticalScroller(true);
                    scroll.setBorderType(NSBorderType::BezelBorder);
                    scroll.setAutohidesScrollers(true);
                    let view: Retained<MentionView> = unsafe { msg_send![MentionView::alloc(mtm), initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(100.0, 80.0))] };
                    view.setRichText(false);
                    view.setFont(Some(&NSFont::systemFontOfSize(13.0)));
                    view.setString(&NSString::from_str(value));
                    view.setAllowsUndo(true);
                    view.setTextContainerInset(NSSize::new(3.0, 5.0));
                    view.setAutomaticQuoteSubstitutionEnabled(false);
                    view.setAutomaticDashSubstitutionEnabled(false);
                    if let Some(p) = placeholder {
                        if unsafe { msg_send![&*view, respondsToSelector: sel!(setPlaceholderString:)] } {
                            let text = NSString::from_str(p);
                            let _: () = unsafe { msg_send![&*view, setPlaceholderString: &*text] };
                        }
                    }
                    view.setDelegate(Some(ProtocolObject::from_ref(controller)));
                    scroll.setDocumentView(Some(&view));
                    root.addSubview(&scroll);
                    let handles: Vec<String> = mentions.iter().map(|m| m.handle.clone()).collect();
                    paint_mentions(&view, &handles);
                    Row { id: id.clone(), label: None, control: Control::TextArea { scroll, view, handles }, line: None }
                }
                SheetRow::Text { id, label: text, value, placeholder, hint, .. } => {
                    let field = NSTextField::textFieldWithString(&NSString::from_str(value), mtm);
                    if let Some(p) = placeholder {
                        field.setPlaceholderString(Some(&NSString::from_str(p)));
                    }
                    unsafe { field.setDelegate(Some(ProtocolObject::from_ref(controller))) };
                    root.addSubview(&field);
                    let label = text.as_deref().map(|t| label(t, mtm));
                    let line = hint.as_deref().map(|h| wrapping(h, 11.0, true, mtm));
                    Row { id: id.clone(), label, control: Control::Text { field }, line }
                }
                SheetRow::Note { text } => Row { id: String::new(), label: None, control: Control::Note, line: Some(wrapping(text, 11.0, true, mtm)) },
                SheetRow::Disclosure { id, label: text, open } => {
                    let triangle = NSButton::new(mtm);
                    triangle.setBezelStyle(NSBezelStyle::Disclosure);
                    triangle.setButtonType(NSButtonType::OnOff);
                    triangle.setTitle(&NSString::from_str(""));
                    triangle.setState(if *open { NSControlStateValueOn } else { NSControlStateValueOff });
                    let title = NSButton::new(mtm);
                    title.setBordered(false);
                    title.setTitle(&NSString::from_str(text));
                    title.setFont(Some(&NSFont::systemFontOfSize(13.0)));
                    unsafe {
                        target(&triangle, controller, sel!(changed:), tag);
                        target(&title, controller, sel!(changed:), tag);
                    }
                    title.sizeToFit();
                    triangle.sizeToFit();
                    root.addSubview(&triangle);
                    root.addSubview(&title);
                    Row { id: id.clone(), label: None, control: Control::Disclosure { triangle, title }, line: None }
                }
                SheetRow::Popup { id, label: text, value, options, hint } => {
                    let button = NSPopUpButton::initWithFrame_pullsDown(NSPopUpButton::alloc(mtm), NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(160.0, 24.0)), false);
                    fill_popup(&button, options, value);
                    unsafe { target(&button, controller, sel!(changed:), tag) };
                    root.addSubview(&button);
                    Row {
                        id: id.clone(),
                        label: Some(label(text, mtm)),
                        control: Control::Popup { button, values: options.iter().map(|o| o.value.clone()).collect(), options: options.clone() },
                        line: hint.as_deref().map(|h| wrapping(h, 11.0, true, mtm)),
                    }
                }
                SheetRow::Segmented { id, label: text, value, options, hint, disabled } => {
                    let control = NSSegmentedControl::new(mtm);
                    control.setTrackingMode(NSSegmentSwitchTracking::SelectOne);
                    fill_segments(&control, options, value);
                    control.setEnabled(!*disabled);
                    unsafe { target(&control, controller, sel!(changed:), tag) };
                    root.addSubview(&control);
                    Row {
                        id: id.clone(),
                        label: Some(label(text, mtm)),
                        control: Control::Segmented { control, values: options.iter().map(|o| o.value.clone()).collect() },
                        line: hint.as_deref().map(|h| wrapping(h, 11.0, true, mtm)),
                    }
                }
            };
            if let Some(l) = &built.label {
                l.setAlignment(NSTextAlignment::Right);
                root.addSubview(l);
            }
            if let Some(l) = &built.line {
                root.addSubview(l);
            }
            rows.push(built);
        }
        rows
    }

    fn fit_height(field: &NSTextField, width: f64) -> f64 {
        field.setPreferredMaxLayoutWidth(width);
        field.fittingSize().height
    }

    /// Places everything from the top and sizes the sheet to fit.
    fn layout(sheet: &Sheet) {
        let width = sheet.spec.width.unwrap_or(520.0);
        let inner = width - 2.0 * MARGIN;
        let label_w = sheet.rows.iter().filter_map(|r| r.label.as_ref()).map(|l| l.fittingSize().width).fold(0.0f64, f64::max).ceil();
        let control_x = MARGIN + label_w + LABEL_GAP;
        let control_w = width - MARGIN - control_x;
        let mut y = MARGIN;
        let title_h = sheet.title.fittingSize().height;
        sheet.title.setFrame(NSRect::new(NSPoint::new(MARGIN, y), NSSize::new(inner, title_h)));
        y += title_h;
        if sheet.spec.intro.as_deref().is_some_and(|i| !i.is_empty()) {
            sheet.intro.setHidden(false);
            let h = fit_height(&sheet.intro, inner);
            sheet.intro.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 2.0), NSSize::new(inner, h)));
            y += h + 2.0;
        } else {
            sheet.intro.setHidden(true);
        }
        y += 14.0;
        for row in &sheet.rows {
            let (line_x, line_w) = match &row.control {
                Control::TextArea { scroll, view, .. } => {
                    let lines = sheet.spec.rows.iter().find_map(|r| match r {
                        SheetRow::TextArea { id, lines, .. } if *id == row.id => Some(lines.unwrap_or(4)),
                        _ => None,
                    }).unwrap_or(4);
                    let h = f64::from(lines) * 17.0 + 12.0;
                    scroll.setFrame(NSRect::new(NSPoint::new(MARGIN, y), NSSize::new(inner, h)));
                    view.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(scroll.contentSize().width, h)));
                    y += h;
                    (MARGIN, inner)
                }
                Control::Text { field } => {
                    let (x, w) = if row.label.is_some() { (control_x, control_w) } else { (MARGIN, inner) };
                    if let Some(l) = &row.label {
                        l.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 3.0), NSSize::new(label_w, 17.0)));
                    }
                    field.setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(w, 22.0)));
                    y += 22.0;
                    (x, w)
                }
                Control::Note => {
                    y -= 4.0;
                    (MARGIN, inner)
                }
                Control::Disclosure { triangle, title } => {
                    let tri = triangle.fittingSize();
                    triangle.setFrame(NSRect::new(NSPoint::new(MARGIN - 4.0, y), NSSize::new(tri.width, tri.height.max(18.0))));
                    let t = title.fittingSize();
                    title.setFrame(NSRect::new(NSPoint::new(MARGIN - 4.0 + tri.width, y), NSSize::new(t.width, 18.0)));
                    y += 18.0;
                    (MARGIN, inner)
                }
                Control::Popup { button, .. } => {
                    let size = button.fittingSize();
                    if let Some(l) = &row.label {
                        l.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 3.0), NSSize::new(label_w, 17.0)));
                    }
                    button.setFrame(NSRect::new(NSPoint::new(control_x - 3.0, y - 1.0), NSSize::new(size.width.clamp(140.0, control_w + 6.0), size.height)));
                    y += size.height - 2.0;
                    (control_x, control_w)
                }
                Control::Segmented { control, .. } => {
                    let size = control.fittingSize();
                    if let Some(l) = &row.label {
                        l.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 3.0), NSSize::new(label_w, 17.0)));
                    }
                    control.setFrame(NSRect::new(NSPoint::new(control_x, y), NSSize::new(size.width.min(control_w), size.height)));
                    y += size.height;
                    (control_x, control_w)
                }
            };
            if let Some(line) = &row.line {
                let h = fit_height(line, line_w);
                line.setFrame(NSRect::new(NSPoint::new(line_x, y + 4.0), NSSize::new(line_w, h)));
                y += h + 4.0;
            }
            y += GAP;
        }
        // The error, then the buttons' row (the footer's checkbox on its left).
        if let Some(text) = sheet.spec.error.as_deref().filter(|e| !e.is_empty()) {
            sheet.error.setStringValue(&NSString::from_str(text));
            sheet.error.setHidden(false);
            let h = fit_height(&sheet.error, inner);
            sheet.error.setFrame(NSRect::new(NSPoint::new(MARGIN, y), NSSize::new(inner, h)));
            y += h + GAP;
        } else {
            sheet.error.setHidden(true);
        }
        y += 6.0;
        sheet.submit.sizeToFit();
        sheet.cancel.sizeToFit();
        let submit_w = sheet.submit.frame().size.width.max(82.0);
        let cancel_w = sheet.cancel.frame().size.width.max(82.0);
        let button_h = sheet.submit.frame().size.height;
        sheet.submit.setFrame(NSRect::new(NSPoint::new(width - MARGIN - submit_w + 6.0, y), NSSize::new(submit_w, button_h)));
        sheet.cancel.setFrame(NSRect::new(NSPoint::new(width - MARGIN - submit_w - cancel_w + 6.0, y), NSSize::new(cancel_w, button_h)));
        let mut bottom = y + button_h;
        if let Some((check, detail)) = &sheet.footer {
            let size = check.fittingSize();
            let room = width - MARGIN - submit_w - cancel_w - MARGIN - 12.0;
            check.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 2.0), NSSize::new(size.width.min(room), size.height)));
            if let Some(detail) = detail {
                let h = fit_height(detail, room - 18.0);
                detail.setFrame(NSRect::new(NSPoint::new(MARGIN + 18.0, y + 2.0 + size.height), NSSize::new(room - 18.0, h)));
                bottom = bottom.max(y + 2.0 + size.height + h);
            }
        }
        let height = bottom + MARGIN;
        sheet.root.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)));
        sheet.panel.setContentSize(NSSize::new(width, height));
    }

    /// Puts the spec's values on the controls that are there (the form's shape is the same).
    fn update_in_place(sheet: &mut Sheet, spec: &SheetSpec) {
        for (row, (built, old)) in spec.rows.iter().zip(sheet.rows.iter_mut().zip(sheet.spec.rows.iter())) {
            if row == old {
                continue;
            }
            match (row, &mut built.control) {
                (SheetRow::TextArea { value, mentions, .. }, Control::TextArea { view, handles, .. }) => {
                    *handles = mentions.iter().map(|m| m.handle.clone()).collect();
                    if view.string().to_string() != *value {
                        view.setString(&NSString::from_str(value));
                    }
                    paint_mentions(view, handles);
                }
                (SheetRow::Text { value, hint, .. }, Control::Text { field }) => {
                    if field.stringValue().to_string() != *value {
                        field.setStringValue(&NSString::from_str(value));
                    }
                    if let (Some(h), Some(line)) = (hint, &built.line) {
                        line.setStringValue(&NSString::from_str(h));
                    }
                }
                (SheetRow::Note { text }, Control::Note) => {
                    if let Some(line) = &built.line {
                        line.setStringValue(&NSString::from_str(text));
                    }
                }
                (SheetRow::Disclosure { label, open, .. }, Control::Disclosure { triangle, title }) => {
                    triangle.setState(if *open { NSControlStateValueOn } else { NSControlStateValueOff });
                    title.setTitle(&NSString::from_str(label));
                }
                (SheetRow::Popup { value, options, label, hint, .. }, Control::Popup { button, values, options: had }) => {
                    if options != had {
                        fill_popup(button, options, value);
                        *values = options.iter().map(|o| o.value.clone()).collect();
                        *had = options.clone();
                    } else if let Some(at) = values.iter().position(|v| v == value) {
                        button.selectItemAtIndex(at as isize);
                    }
                    if let Some(l) = &built.label {
                        l.setStringValue(&NSString::from_str(label));
                    }
                    if let (Some(h), Some(line)) = (hint, &built.line) {
                        line.setStringValue(&NSString::from_str(h));
                    }
                }
                (SheetRow::Segmented { value, options, disabled, hint, .. }, Control::Segmented { control, values }) => {
                    fill_segments(control, options, value);
                    *values = options.iter().map(|o| o.value.clone()).collect();
                    control.setEnabled(!*disabled);
                    if let (Some(h), Some(line)) = (hint, &built.line) {
                        line.setStringValue(&NSString::from_str(h));
                    }
                }
                _ => {}
            }
        }
    }

    fn apply_chrome(sheet: &Sheet) {
        let spec = &sheet.spec;
        sheet.title.setStringValue(&NSString::from_str(&spec.title));
        sheet.intro.setStringValue(&NSString::from_str(spec.intro.as_deref().unwrap_or("")));
        sheet.cancel.setTitle(&NSString::from_str(&spec.cancel));
        sheet.submit.setTitle(&NSString::from_str(&spec.submit));
        sheet.submit.setEnabled(spec.can_submit && !spec.busy);
        sheet.submit_cmd.setEnabled(spec.can_submit && !spec.busy);
        sheet.cancel.setEnabled(!spec.busy);
        if let (Some((check, detail)), Some(footer)) = (&sheet.footer, &spec.footer) {
            check.setTitle(&NSString::from_str(&footer.label));
            check.setState(if footer.checked { NSControlStateValueOn } else { NSControlStateValueOff });
            if let (Some(d), Some(text)) = (detail, &footer.detail) {
                d.setStringValue(&NSString::from_str(text));
            }
        }
    }

    fn focus_first(sheet: &Sheet) {
        let wants = sheet.spec.rows.iter().position(|r| matches!(r, SheetRow::TextArea { focus: true, .. } | SheetRow::Text { focus: true, .. }));
        let at = wants.or_else(|| sheet.rows.iter().position(|r| matches!(r.control, Control::TextArea { .. } | Control::Text { .. })));
        if let Some(row) = at.and_then(|i| sheet.rows.get(i)) {
            match &row.control {
                Control::TextArea { view, .. } => {
                    sheet.panel.makeFirstResponder(Some(view));
                }
                Control::Text { field } => {
                    sheet.panel.makeFirstResponder(Some(field));
                }
                _ => {}
            }
        }
    }

    pub fn open(parent: *mut std::ffi::c_void, spec: SheetSpec, emit: Box<dyn Fn(SheetEvent)>) -> bool {
        let Some(mtm) = MainThreadMarker::new() else { return false };
        close();
        // SAFETY: the app's own window, alive while it's open.
        let Some(parent) = (unsafe { parent.cast::<NSWindow>().as_ref() }) else { return false };
        let parent: Retained<NSWindow> = unsafe { Retained::retain(parent as *const NSWindow as *mut NSWindow) }.expect("window");
        let width = spec.width.unwrap_or(520.0);
        let panel = {
            NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, 300.0)), NSWindowStyleMask::Titled, NSBackingStoreType::Buffered, false)
        };
        unsafe { panel.setReleasedWhenClosed(false) };
        let root: Retained<Flipped> = unsafe { msg_send![Flipped::alloc(mtm), initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, 300.0))] };
        panel.setContentView(Some(&root));
        let controller: Retained<Controller> = unsafe { msg_send![Controller::alloc(mtm), init] };

        let title = label(&spec.title, mtm);
        title.setFont(Some(&NSFont::boldSystemFontOfSize(13.0)));
        root.addSubview(&title);
        let intro = wrapping(spec.intro.as_deref().unwrap_or(""), 11.0, true, mtm);
        root.addSubview(&intro);
        let error = wrapping("", 11.0, false, mtm);
        error.setTextColor(Some(&NSColor::systemRedColor()));
        root.addSubview(&error);

        let cancel = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(&spec.cancel), Some(&controller), Some(sel!(cancel:)), mtm) };
        cancel.setKeyEquivalent(&NSString::from_str("\u{1b}"));
        let submit = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(&spec.submit), Some(&controller), Some(sel!(submit:)), mtm) };
        submit.setKeyEquivalent(&NSString::from_str("\r"));
        // ⌘Return presses it from the text view too (where Return is a new line).
        let submit_cmd = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(""), Some(&controller), Some(sel!(submit:)), mtm) };
        submit_cmd.setKeyEquivalent(&NSString::from_str("\r"));
        submit_cmd.setKeyEquivalentModifierMask(objc2_app_kit::NSEventModifierFlags::Command);
        submit_cmd.setFrame(NSRect::new(NSPoint::new(-100.0, -100.0), NSSize::new(1.0, 1.0)));
        root.addSubview(&cancel);
        root.addSubview(&submit);
        root.addSubview(&submit_cmd);

        let footer = spec.footer.as_ref().map(|f| {
            let check = unsafe { NSButton::checkboxWithTitle_target_action(&NSString::from_str(&f.label), Some(&controller), Some(sel!(changed:)), mtm) };
            check.setTag(FOOTER_TAG);
            root.addSubview(&check);
            let detail = f.detail.as_deref().map(|d| {
                let l = wrapping(d, 11.0, true, mtm);
                root.addSubview(&l);
                l
            });
            (check, detail)
        });

        let rows = build_rows(&spec, &root, &controller, mtm);
        let shape = spec.rows.iter().map(SheetRow::shape).collect();
        let sheet = Sheet { parent: parent.clone(), panel: panel.clone(), root, controller, spec, shape, title, intro, rows, footer, error, cancel, submit, submit_cmd, emit };
        apply_chrome(&sheet);
        layout(&sheet);
        focus_first(&sheet);
        SHEET.with(|s| *s.borrow_mut() = Some(sheet));
        parent.beginSheet_completionHandler(&panel, None);
        true
    }

    pub fn update(spec: SheetSpec) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        SHEET.with(|s| {
            let mut s = s.borrow_mut();
            let Some(sheet) = s.as_mut() else { return };
            let shape: Vec<String> = spec.rows.iter().map(SheetRow::shape).collect();
            let rebuilt = shape != sheet.shape;
            if rebuilt {
                for row in sheet.rows.drain(..) {
                    if let Some(l) = row.label {
                        l.removeFromSuperview();
                    }
                    if let Some(l) = row.line {
                        l.removeFromSuperview();
                    }
                    match row.control {
                        Control::TextArea { scroll, .. } => scroll.removeFromSuperview(),
                        Control::Text { field } => field.removeFromSuperview(),
                        Control::Disclosure { triangle, title } => {
                            triangle.removeFromSuperview();
                            title.removeFromSuperview();
                        }
                        Control::Popup { button, .. } => button.removeFromSuperview(),
                        Control::Segmented { control, .. } => control.removeFromSuperview(),
                        Control::Note => {}
                    }
                }
                sheet.rows = build_rows(&spec, &sheet.root, &sheet.controller, mtm);
                sheet.shape = shape;
            } else {
                update_in_place(sheet, &spec);
            }
            sheet.spec = spec;
            apply_chrome(sheet);
            layout(sheet);
            if rebuilt {
                focus_first(sheet);
            }
        });
    }

    pub fn close() {
        let sheet = SHEET.with(|s| s.borrow_mut().take());
        if let Some(sheet) = sheet {
            sheet.parent.endSheet(&sheet.panel);
            sheet.panel.orderOut(None);
        }
    }
}

/// Opens the form as a sheet on the window; its changes come back as `native-sheet` events.
#[tauri::command]
pub async fn native_sheet_open(window: tauri::Window, spec: SheetSpec) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::Emitter;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let ns = window.ns_window().map_err(|e| e.to_string())? as usize;
        let to = window.clone();
        window
            .run_on_main_thread(move || {
                let emit: Box<dyn Fn(SheetEvent)> = Box::new(move |event| {
                    let _ = to.emit("native-sheet", event);
                });
                let _ = tx.send(mac::open(ns as *mut std::ffi::c_void, spec, emit));
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, spec);
        Ok(false)
    }
}

/// The form again, as it is now (the page's state changed).
#[tauri::command]
pub async fn native_sheet_update(window: tauri::Window, spec: SheetSpec) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window.run_on_main_thread(move || mac::update(spec)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (window, spec);
    Ok(())
}

/// Closes the sheet (submitted, cancelled, or the page gave up on it).
#[tauri::command]
pub async fn native_sheet_close(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window.run_on_main_thread(mac::close).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The form as lib/native-sheet.ts sends it (its `wire`): every kind of row, a footer, a picture.
    #[test]
    fn reads_the_form_the_page_sends() {
        let json = r#"{
            "title": "New Task", "intro": "Ready", "width": 560,
            "rows": [
                { "kind": "textarea", "id": "describe", "value": "Ask @mia", "lines": 4, "focus": true, "placeholder": "Say what you want", "mentions": [{ "handle": "@mia" }] },
                { "kind": "note", "text": "⌘↩ creates it." },
                { "kind": "disclosure", "id": "mine", "label": "Write title and goal myself", "open": false },
                { "kind": "text", "id": "title", "label": "Title:", "value": "", "placeholder": "Rate-limit" },
                { "kind": "popup", "id": "agent", "label": "Agent:", "value": "yours", "hint": "Who works on it", "options": [{ "value": "yours", "label": "Your agent", "icon": [1, 2], "template": true }] },
                { "kind": "segmented", "id": "priority", "label": "Priority:", "value": "none", "disabled": false, "options": [{ "value": "none", "label": "None" }, { "value": "low", "label": "Low" }] }
            ],
            "footer": { "id": "start", "label": "Start with your agent", "detail": "A new worktree", "checked": false },
            "cancel": "Cancel", "submit": "Create Task", "canSubmit": false, "busy": false
        }"#;
        let spec: SheetSpec = serde_json::from_str(json).expect("the page's form");
        assert_eq!(spec.rows.len(), 6);
        assert!(matches!(&spec.rows[0], SheetRow::TextArea { mentions, focus: true, .. } if mentions[0].handle == "@mia"));
        assert!(matches!(&spec.rows[4], SheetRow::Popup { options, .. } if options[0].icon.as_deref() == Some(&[1u8, 2][..])));
        assert_eq!(spec.footer.map(|f| f.id), Some("start".into()));
        assert!(!spec.can_submit);
        // Its shape: what decides building the rows again.
        let shapes: Vec<String> = spec.rows.iter().map(SheetRow::shape).collect();
        assert_eq!(shapes, ["textarea:describe", "note", "disclosure:mine", "text:title:true", "popup:agent", "segmented:priority:2"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finds_a_handle_without_case_and_keeps_the_text_s_offsets() {
        use super::mac::match_at;
        assert_eq!(match_at("Ask @Mia now", 4, "@mia"), Some(8));
        assert_eq!(match_at("Ask @Mi", 4, "@mia"), None);
        // A letter whose lower case is longer (İ → i̇): the end is still the text's own.
        assert_eq!(match_at("@İa x", 0, "@i̇a"), Some(4));
    }

    #[test]
    fn says_what_changed_as_the_page_reads_it() {
        let json = serde_json::to_value(SheetEvent::Change { id: "priority".into(), value: "high".into() }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "change", "id": "priority", "value": "high" }));
        assert_eq!(serde_json::to_value(SheetEvent::Submit).unwrap(), serde_json::json!({ "kind": "submit" }));
    }
}
