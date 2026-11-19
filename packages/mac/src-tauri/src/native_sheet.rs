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

// Only a Mac shows these: elsewhere each command says no, and the types it would read go unused.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

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
    /// A line under it in the open menu (macOS 14.4's subtitle; a tooltip before).
    #[serde(default)]
    pub hint: Option<String>,
    /// The section it's in: a new one starts with a line and its title.
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    /// A word in a card's corner ("Now").
    #[serde(default)]
    pub badge: Option<String>,
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
        /// At most this many characters (cut as you type).
        #[serde(default, rename = "maxLength")]
        max_length: Option<usize>,
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
        /// As you type: at most this many characters, in capitals, only these characters.
        #[serde(default, rename = "maxLength")]
        max_length: Option<usize>,
        #[serde(default)]
        upper: bool,
        #[serde(default)]
        keep: Option<String>,
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
    /// Option cards side by side, as the app's own (plans.module.css's .modeCards): each its icon,
    /// its name and its line, the chosen one outlined in the accent, a word in a card's corner.
    /// Its label is a heading above them, across the sheet.
    #[serde(rename = "cards")]
    Cards {
        id: String,
        label: String,
        value: String,
        options: Vec<SheetOption>,
    },
    /// A tinted box of words (what changes, before Save confirms it: .modeConfirm), its second line dimmer.
    #[serde(rename = "callout")]
    Callout {
        text: String,
        #[serde(default)]
        detail: Option<String>,
    },
    /// A push button in the control column ("Choose Another Folder…"): pressing it says "press".
    #[serde(rename = "button")]
    Button {
        id: String,
        #[serde(default)]
        label: Option<String>,
        text: String,
        #[serde(default)]
        hint: Option<String>,
    },
    #[serde(rename = "checkbox")]
    Checkbox {
        id: String,
        #[serde(default)]
        label: Option<String>,
        text: String,
        checked: bool,
        #[serde(default)]
        hint: Option<String>,
        /// Shown, not changed (a board's own repo).
        #[serde(default)]
        disabled: bool,
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
            SheetRow::Checkbox { id, label, .. } => format!("checkbox:{id}:{}", label.is_some()),
            SheetRow::Button { id, label, .. } => format!("button:{id}:{}", label.is_some()),
            SheetRow::Cards { id, options, .. } => format!("cards:{id}:{}", options.len()),
            SheetRow::Callout { detail, .. } => format!("callout:{}", detail.is_some()),
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
pub struct AsideButton {
    pub id: String,
    pub label: String,
}

/// The colours the page draws in now (Settings › Appearance), each `#rrggbb`: the sheet follows them,
/// not the Mac's own light/dark and accent, so it matches the window it slides out of.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetPalette {
    pub dark: bool,
    pub accent: String,
    pub bg: String,
    pub surface: String,
}

/// `#rrggbb` → its red, green and blue, 0–1.
pub fn rgb_of(hex: &str) -> Option<(f64, f64, f64)> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 || !h.is_ascii() {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok().map(|b| f64::from(b) / 255.0);
    Some((byte(0)?, byte(2)?, byte(4)?))
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
    /// A button on the left of the buttons' row ("Delete Board…"): pressing it says "press".
    #[serde(default)]
    pub aside: Option<AsideButton>,
    pub cancel: String,
    pub submit: String,
    pub can_submit: bool,
    #[serde(default)]
    pub busy: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub palette: Option<SheetPalette>,
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

/// What a field takes as you type (`max_length`, `upper`, `keep`): the text as it should stand.
pub fn filtered(text: &str, max_length: Option<usize>, upper: bool, keep: Option<&str>) -> String {
    let mut out: String = text.chars().map(|c| if upper { c.to_uppercase().next().unwrap_or(c) } else { c }).filter(|c| keep.is_none_or(|k| k.contains(*c))).collect();
    if let Some(max) = max_length {
        out = out.chars().take(max).collect();
    }
    out
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{rgb_of, SheetEvent, SheetOption, SheetPalette, SheetRow, SheetSpec};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject, Sel};
    use objc2::{define_class, msg_send, sel, AllocAnyThread, ClassType, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSBackingStoreType, NSBezelStyle, NSBox, NSBoxType, NSImageView, NSTitlePosition, NSBorderType, NSButton, NSButtonType, NSColor, NSControl, NSControlStateValueOff, NSControlStateValueOn, NSControlTextEditingDelegate, NSFont,
        NSForegroundColorAttributeName, NSImage, NSMenuItem, NSPanel, NSPopUpButton, NSScrollView, NSSegmentSwitchTracking, NSSegmentedControl, NSTextAlignment, NSTextDelegate, NSTextField,
        NSTextFieldDelegate, NSTextView, NSTextViewDelegate, NSView, NSWindow, NSWindowStyleMask,
    };
    use objc2_foundation::{NSArray, NSData, NSNotification, NSPoint, NSRange, NSRect, NSSize, NSString};
    use std::cell::{Cell, RefCell};
    use std::ptr::NonNull;

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
        Checkbox { button: Retained<NSButton> },
        Button { button: Retained<NSButton> },
        Cards { cards: Vec<Card>, values: Vec<String> },
        Callout { boxed: Retained<NSBox>, text: Retained<NSTextField>, detail: Option<Retained<NSTextField>> },
    }

    /// One option card: its box, what's in it, and the button over it that picks it.
    struct Card {
        boxed: Retained<NSBox>,
        content: Retained<Flipped>,
        icon: Option<Retained<NSImageView>>,
        name: Retained<NSTextField>,
        line: Option<Retained<NSTextField>>,
        badge: Option<Retained<NSTextField>>,
        hit: Retained<NSButton>,
    }

    struct Row {
        id: String,
        label: Option<Retained<NSTextField>>,
        control: Control,
        /// The note's own text, or the hint under the control.
        line: Option<Retained<NSTextField>>,
    }

    struct Sheet {
        /// Which sheet this is: an update or close for another (an earlier one, still on its way) is dropped.
        id: u64,
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
        aside: Option<Retained<NSButton>>,
        error: Retained<NSTextField>,
        cancel: Retained<NSButton>,
        submit: Retained<NSButton>,
        submit_cmd: Retained<NSButton>,
        emit: Box<dyn Fn(SheetEvent)>,
    }

    thread_local! {
        static SHEET: RefCell<Option<Sheet>> = const { RefCell::new(None) };
        static NEXT_ID: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
        /// The page's colours for the sheet being built or updated (none: the Mac's own).
        static PALETTE: RefCell<Option<SheetPalette>> = const { RefCell::new(None) };
    }

    fn colour(pick: impl FnOnce(&SheetPalette) -> &str) -> Option<Retained<NSColor>> {
        PALETTE.with(|p| p.borrow().as_ref().and_then(|p| rgb_of(pick(p))).map(|(r, g, b)| NSColor::colorWithSRGBRed_green_blue_alpha(r, g, b, 1.0)))
    }
    /// The accent the page uses (Settings › Accent), or the Mac's.
    fn accent() -> Retained<NSColor> {
        colour(|p| &p.accent).unwrap_or_else(NSColor::controlAccentColor)
    }
    /// Under the cards: the page's var(--bg), or the Mac's text background.
    fn card_fill() -> Retained<NSColor> {
        colour(|p| &p.bg).unwrap_or_else(NSColor::textBackgroundColor)
    }

    /// The sheet as it is, for a callback: none while it's being updated (`update` holds it, and
    /// AppKit can call back in the middle: an input method committing its text as a field goes).
    /// A panic in an Objective-C callback would take the whole app down, so a busy cell is skipped.
    fn peek<R>(f: impl FnOnce(&Sheet) -> Option<R>) -> Option<R> {
        SHEET.with(|s| s.try_borrow().ok().and_then(|b| b.as_ref().and_then(f)))
    }

    fn emit(event: SheetEvent) {
        // Read the callback out first: the page's answer comes back later, never inside this call.
        let call = peek(|s| Some(s.emit.as_ref() as *const dyn Fn(SheetEvent)));
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
                let ok = peek(|s| Some(s.spec.can_submit && !s.spec.busy)).unwrap_or(false);
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
                let id = peek(|s| {
                    s.rows.iter().find_map(|r| match &r.control {
                        Control::Text { field } if std::ptr::eq(Retained::as_ptr(field) as *const AnyObject, Retained::as_ptr(&object)) => {
                            let rule = s.spec.rows.iter().find_map(|row| match row {
                                SheetRow::Text { id, max_length, upper, keep, .. } if *id == r.id => Some((*max_length, *upper, keep.clone())),
                                _ => None,
                            });
                            Some((r.id.clone(), field.clone(), rule))
                        }
                        _ => None,
                    })
                });
                if let Some((id, field, rule)) = id {
                    // What the field takes, in the field itself as you type (the page's own checks
                    // can't put it back while you type: an update leaves a field being typed in).
                    let typed = field.stringValue().to_string();
                    let value = match rule {
                        Some((max, upper, keep)) => super::filtered(&typed, max, upper, keep.as_deref()),
                        None => typed.clone(),
                    };
                    if value != typed {
                        field.setStringValue(&NSString::from_str(&value));
                    }
                    emit(SheetEvent::Change { id, value });
                }
            }
        }

        unsafe impl NSTextFieldDelegate for Controller {}

        unsafe impl NSTextDelegate for Controller {
            #[unsafe(method(textDidChange:))]
            fn text_did_change(&self, note: &NSNotification) {
                let Some(object) = note.object() else { return };
                let found = peek(|s| {
                    s.rows.iter().find_map(|r| match &r.control {
                        Control::TextArea { view, handles, .. } if std::ptr::eq(Retained::as_ptr(view) as *const AnyObject, Retained::as_ptr(&object)) => {
                            Some((r.id.clone(), view.clone(), handles.clone()))
                        }
                        _ => None,
                    })
                });
                let Some((id, view, handles)) = found else { return };
                let max = peek(|s| s.spec.rows.iter().find_map(|row| match row {
                    SheetRow::TextArea { id: rid, max_length, .. } if *rid == id => *max_length,
                    _ => None,
                }));
                if let Some(max) = max {
                    let text = view.string().to_string();
                    if text.chars().count() > max {
                        view.setString(&NSString::from_str(&text.chars().take(max).collect::<String>()));
                    }
                }
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
                let handles = peek(|s| {
                    Some(s.rows.iter().flat_map(|r| match &r.control {
                        Control::TextArea { handles, .. } => handles.clone(),
                        _ => vec![],
                    }).collect::<Vec<_>>())
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
                unsafe { storage.addAttribute_value_range(NSForegroundColorAttributeName, &accent(), NSRange::new(from, len)) };
                break;
            }
        }
        storage.endEditing();
    }

    /// The change a control's action stands for.
    fn change_of(sender: &NSControl) -> Option<SheetEvent> {
        let tag = sender.tag();
        SHEET.with(|s| {
            let s = s.try_borrow().ok()?;
            let s = s.as_ref()?;
            if tag >= RADIO_TAG {
                let (row, option) = ((tag - RADIO_TAG) / RADIO_ROW, (tag - RADIO_TAG) % RADIO_ROW);
                let built = s.rows.get(row as usize)?;
                let values = match &built.control {
                    Control::Cards { values, .. } => values,
                    _ => return None,
                };
                return Some(SheetEvent::Change { id: built.id.clone(), value: values.get(option as usize)?.clone() });
            }
            if tag == ASIDE_TAG {
                return Some(SheetEvent::Change { id: s.spec.aside.as_ref()?.id.clone(), value: "press".into() });
            }
            if tag == FOOTER_TAG {
                let (check, _) = s.footer.as_ref()?;
                let id = s.spec.footer.as_ref()?.id.clone();
                return Some(SheetEvent::Change { id, value: (check.state() == NSControlStateValueOn).to_string() });
            }
            let row = s.rows.get(tag as usize)?;
            let value = match &row.control {
                Control::Popup { button, values, .. } => values.get(usize::try_from(button.selectedTag()).ok()?)?.clone(),
                Control::Checkbox { button } => (button.state() == NSControlStateValueOn).to_string(),
                Control::Button { .. } => "press".into(),
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
    const ASIDE_TAG: isize = 10_001;
    /// An option card's tag: RADIO_TAG + its row × RADIO_ROW + its option (a card set has a few).
    const RADIO_TAG: isize = 20_000;
    const RADIO_ROW: isize = 64;

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

    /// The pop-up's menu: each option an item tagged with its index (so two with the same name stay
    /// two, which addItemWithTitle wouldn't), a section's title before its first, the chosen one picked.
    fn fill_popup(button: &NSPopUpButton, options: &[SheetOption], value: &str, mtm: MainThreadMarker) {
        button.removeAllItems();
        let Some(menu) = button.menu() else { return };
        menu.setAutoenablesItems(false);
        let headers = responds(NSMenuItem::class().as_ref(), sel!(sectionHeaderWithTitle:));
        let mut section: Option<&str> = None;
        for (i, option) in options.iter().enumerate() {
            if option.section.as_deref() != section {
                section = option.section.as_deref();
                if i > 0 {
                    menu.addItem(&NSMenuItem::separatorItem(mtm));
                }
                if let Some(title) = section.filter(|t| !t.is_empty()) {
                    let title = NSString::from_str(title);
                    let head = if headers {
                        NSMenuItem::sectionHeaderWithTitle(&title, mtm)
                    } else {
                        let head = NSMenuItem::new(mtm);
                        head.setTitle(&title);
                        head.setEnabled(false);
                        head
                    };
                    head.setTag(-1);
                    menu.addItem(&head);
                }
            }
            let item = NSMenuItem::new(mtm);
            item.setTitle(&NSString::from_str(&option.label));
            item.setTag(i as isize);
            item.setEnabled(!option.disabled);
            if let Some(png) = option.icon.as_deref() {
                item.setImage(image(png, option.template.unwrap_or(true)).as_deref());
            }
            if let Some(hint) = option.hint.as_deref().filter(|h| !h.is_empty()) {
                let text = NSString::from_str(hint);
                if responds(item.as_ref(), sel!(setSubtitle:)) {
                    item.setSubtitle(Some(&text));
                } else {
                    item.setToolTip(Some(&text));
                }
            }
            menu.addItem(&item);
        }
        if let Some(at) = options.iter().position(|o| o.value == value) {
            button.selectItemWithTag(at as isize);
        }
        button.sizeToFit();
    }

    fn responds(obj: &AnyObject, selector: Sel) -> bool {
        unsafe { msg_send![obj, respondsToSelector: selector] }
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

    /// The accent mixed into the window's background, as color-mix(in srgb, var(--accent) N%, var(--bg)).
    /// A dynamic colour, mixed again in the appearance it is drawn in: blending the two system colours
    /// once resolves them in whatever appearance is current at that moment (the system's, not the
    /// window's), so a light window on a dark Mac got a dark navy card and callout.
    fn tint(fraction: f64) -> Retained<NSColor> {
        if let (Some(bg), Some(accent)) = (colour(|p| &p.bg), colour(|p| &p.accent)) {
            return bg.blendedColorWithFraction_ofColor(fraction, &accent).unwrap_or(bg);
        }
        let provider = RcBlock::new(move |appearance: NonNull<NSAppearance>| -> NonNull<NSColor> {
            let mixed: Cell<Option<Retained<NSColor>>> = Cell::new(None);
            let resolve = RcBlock::new(|| {
                let bg = NSColor::textBackgroundColor();
                mixed.set(Some(bg.blendedColorWithFraction_ofColor(fraction, &NSColor::controlAccentColor()).unwrap_or(bg)));
            });
            unsafe { appearance.as_ref() }.performAsCurrentDrawingAppearance(&resolve);
            let color = mixed.take().unwrap_or_else(NSColor::textBackgroundColor);
            NonNull::new(Retained::autorelease_return(color)).expect("a colour")
        });
        unsafe { NSColor::colorWithName_dynamicProvider(None, &provider) }
    }

    fn custom_box(mtm: MainThreadMarker) -> Retained<NSBox> {
        let b = NSBox::new(mtm);
        b.setBoxType(NSBoxType::Custom);
        b.setTitlePosition(NSTitlePosition::NoTitle);
        b.setContentViewMargins(NSSize::new(0.0, 0.0));
        b.setCornerRadius(8.0);
        b
    }

    /// A card as chosen or not: the accent's 1.5 outline and an 8% tint, or a hairline on the background.
    fn style_card(card: &Card, on: bool) {
        if on {
            card.boxed.setBorderWidth(1.5);
            card.boxed.setBorderColor(&accent());
            card.boxed.setFillColor(&tint(0.08));
        } else {
            card.boxed.setBorderWidth(0.5);
            card.boxed.setBorderColor(&NSColor::separatorColor());
            card.boxed.setFillColor(&card_fill());
        }
        if let Some(icon) = &card.icon {
            let tint = if on { accent() } else { NSColor::tertiaryLabelColor() };
            icon.setContentTintColor(Some(&tint));
        }
    }

    fn build_card(option: &SheetOption, on: bool, tag: isize, root: &Flipped, controller: &Controller, mtm: MainThreadMarker) -> Card {
        let boxed = custom_box(mtm);
        let content: Retained<Flipped> = unsafe { msg_send![Flipped::alloc(mtm), initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(100.0, 60.0))] };
        boxed.setContentView(Some(&content));
        let icon = option.icon.as_deref().and_then(|png| image(png, true)).map(|img| {
            img.setSize(NSSize::new(16.0, 16.0));
            let view = NSImageView::imageViewWithImage(&img, mtm);
            content.addSubview(&view);
            view
        });
        let name = label(&option.label, mtm);
        name.setFont(Some(&NSFont::boldSystemFontOfSize(13.0)));
        content.addSubview(&name);
        let line = option.hint.as_deref().filter(|h| !h.is_empty()).map(|h| {
            let l = wrapping(h, 11.5, true, mtm);
            content.addSubview(&l);
            l
        });
        let badge = option.badge.as_deref().map(|b| {
            let l = label(b, mtm);
            l.setFont(Some(&NSFont::boldSystemFontOfSize(10.5)));
            l.setTextColor(Some(&NSColor::tertiaryLabelColor()));
            content.addSubview(&l);
            l
        });
        root.addSubview(&boxed);
        // Over the card, the whole of it picks it.
        let hit = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(""), Some(controller), Some(sel!(changed:)), mtm) };
        hit.setTransparent(true);
        hit.setTag(tag);
        root.addSubview(&hit);
        let card = Card { boxed, content, icon, name, line, badge, hit };
        style_card(&card, on);
        card
    }

    /// Lays a card's insides out at `width`; its height.
    fn layout_card(card: &Card, width: f64) -> f64 {
        let (pad_x, pad_top, pad_bottom) = (12.0, 10.0, 11.0);
        let inner = width - 2.0 * pad_x;
        let mut y = pad_top;
        if let Some(icon) = &card.icon {
            icon.setFrame(NSRect::new(NSPoint::new(pad_x, y), NSSize::new(16.0, 16.0)));
            y += 16.0 + 6.0;
        }
        let h = card.name.fittingSize().height;
        card.name.setFrame(NSRect::new(NSPoint::new(pad_x, y), NSSize::new(inner, h)));
        y += h;
        if let Some(line) = &card.line {
            let lh = fit_height(line, inner);
            line.setFrame(NSRect::new(NSPoint::new(pad_x, y + 3.0), NSSize::new(inner, lh)));
            y += lh + 3.0;
        }
        if let Some(badge) = &card.badge {
            let size = badge.fittingSize();
            badge.setFrame(NSRect::new(NSPoint::new(width - 10.0 - size.width, 9.0), size));
        }
        y + pad_bottom
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
                    fill_popup(&button, options, value, mtm);
                    unsafe { target(&button, controller, sel!(changed:), tag) };
                    root.addSubview(&button);
                    Row {
                        id: id.clone(),
                        label: Some(label(text, mtm)),
                        control: Control::Popup { button, values: options.iter().map(|o| o.value.clone()).collect(), options: options.clone() },
                        line: hint.as_deref().map(|h| wrapping(h, 11.0, true, mtm)),
                    }
                }
                SheetRow::Cards { id, label: text, value, options } => {
                    let cards = options.iter().enumerate().map(|(o, option)| build_card(option, option.value == *value, RADIO_TAG + tag * RADIO_ROW + o as isize, root, controller, mtm)).collect();
                    let heading = label(text, mtm);
                    Row { id: id.clone(), label: Some(heading), control: Control::Cards { cards, values: options.iter().map(|o| o.value.clone()).collect() }, line: None }
                }
                SheetRow::Callout { text, detail } => {
                    let boxed = custom_box(mtm);
                    boxed.setBorderWidth(0.5);
                    boxed.setBorderColor(&accent().colorWithAlphaComponent(0.4));
                    boxed.setFillColor(&tint(0.07));
                    let inside: Retained<Flipped> = unsafe { msg_send![Flipped::alloc(mtm), initWithFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(100.0, 40.0))] };
                    boxed.setContentView(Some(&inside));
                    let words = wrapping(text, 13.0, false, mtm);
                    inside.addSubview(&words);
                    let more = detail.as_deref().filter(|d| !d.is_empty()).map(|d| {
                        let l = wrapping(d, 13.0, true, mtm);
                        inside.addSubview(&l);
                        l
                    });
                    root.addSubview(&boxed);
                    Row { id: String::new(), label: None, control: Control::Callout { boxed, text: words, detail: more }, line: None }
                }
                SheetRow::Button { id, label: text, text: title, hint } => {
                    let button = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(title), Some(controller), Some(sel!(changed:)), mtm) };
                    button.setTag(tag);
                    root.addSubview(&button);
                    Row { id: id.clone(), label: text.as_deref().map(|t| label(t, mtm)), control: Control::Button { button }, line: hint.as_deref().map(|h| wrapping(h, 11.0, true, mtm)) }
                }
                SheetRow::Checkbox { id, label: text, text: title, checked, hint, disabled } => {
                    let button = unsafe { NSButton::checkboxWithTitle_target_action(&NSString::from_str(title), Some(controller), Some(sel!(changed:)), mtm) };
                    button.setTag(tag);
                    button.setEnabled(!*disabled);
                    button.setState(if *checked { NSControlStateValueOn } else { NSControlStateValueOff });
                    root.addSubview(&button);
                    Row { id: id.clone(), label: text.as_deref().map(|t| label(t, mtm)), control: Control::Checkbox { button }, line: hint.as_deref().map(|h| wrapping(h, 11.0, true, mtm)) }
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
        let label_w = sheet.rows.iter().filter(|r| !matches!(r.control, Control::Cards { .. })).filter_map(|r| r.label.as_ref()).map(|l| l.fittingSize().width).fold(0.0f64, f64::max).ceil();
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
                Control::Cards { cards, .. } => {
                    if let Some(l) = &row.label {
                        l.setAlignment(NSTextAlignment::Left);
                        let h = l.fittingSize().height;
                        l.setFrame(NSRect::new(NSPoint::new(MARGIN, y), NSSize::new(inner, h)));
                        y += h + 6.0;
                    }
                    let n = cards.len().max(1) as f64;
                    let w = ((inner - 8.0 * (n - 1.0)) / n).floor();
                    let tallest = cards.iter().map(|c| layout_card(c, w)).fold(0.0f64, f64::max);
                    for (i, card) in cards.iter().enumerate() {
                        let frame = NSRect::new(NSPoint::new(MARGIN + i as f64 * (w + 8.0), y), NSSize::new(w, tallest));
                        card.boxed.setFrame(frame);
                        card.content.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w, tallest)));
                        card.hit.setFrame(frame);
                    }
                    y += tallest;
                    (MARGIN, inner)
                }
                Control::Callout { boxed, text, detail } => {
                    let (pad_x, pad_y) = (12.0, 10.0);
                    let w = inner - 2.0 * pad_x;
                    let mut h = pad_y;
                    let th = fit_height(text, w);
                    text.setFrame(NSRect::new(NSPoint::new(pad_x, h), NSSize::new(w, th)));
                    h += th;
                    if let Some(d) = detail {
                        let dh = fit_height(d, w);
                        d.setFrame(NSRect::new(NSPoint::new(pad_x, h + 4.0), NSSize::new(w, dh)));
                        h += dh + 4.0;
                    }
                    h += pad_y;
                    boxed.setFrame(NSRect::new(NSPoint::new(MARGIN, y), NSSize::new(inner, h)));
                    if let Some(inside) = boxed.contentView() {
                        inside.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(inner, h)));
                    }
                    y += h;
                    (MARGIN, inner)
                }
                Control::Button { button } => {
                    let size = button.fittingSize();
                    let x = if row.label.is_some() { control_x } else { MARGIN };
                    if let Some(l) = &row.label {
                        l.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 4.0), NSSize::new(label_w, 17.0)));
                    }
                    button.setFrame(NSRect::new(NSPoint::new(x - 6.0, y - 1.0), size));
                    y += size.height - 2.0;
                    (x, if row.label.is_some() { control_w } else { inner })
                }
                Control::Checkbox { button } => {
                    let size = button.fittingSize();
                    let (x, w) = if row.label.is_some() { (control_x, control_w) } else { (MARGIN, inner) };
                    if let Some(l) = &row.label {
                        l.setFrame(NSRect::new(NSPoint::new(MARGIN, y + 1.0), NSSize::new(label_w, 17.0)));
                    }
                    button.setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(size.width.min(w), size.height)));
                    y += size.height;
                    (x + 18.0, w - 18.0)
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
        if let Some(aside) = &sheet.aside {
            aside.sizeToFit();
            let size = aside.frame().size;
            aside.setFrame(NSRect::new(NSPoint::new(MARGIN - 6.0, y), NSSize::new(size.width.max(82.0), size.height)));
        }
        let height = bottom + MARGIN;
        sheet.root.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)));
        sheet.panel.setContentSize(NSSize::new(width, height));
    }

    /// Puts the spec's values on the controls that are there (the form's shape is the same).
    fn update_in_place(sheet: &mut Sheet, spec: &SheetSpec, mtm: MainThreadMarker) {
        // What has the focus now: a field being typed in keeps its own text (see below).
        let focused = sheet.panel.firstResponder().map(|r| Retained::as_ptr(&r) as *const AnyObject);
        for (row, (built, old)) in spec.rows.iter().zip(sheet.rows.iter_mut().zip(sheet.spec.rows.iter())) {
            if row == old {
                continue;
            }
            match (row, &mut built.control) {
                (SheetRow::TextArea { value, mentions, .. }, Control::TextArea { view, handles, .. }) => {
                    *handles = mentions.iter().map(|m| m.handle.clone()).collect();
                    // Being typed in: what the page sends back is what it typed a moment ago, so
                    // setting it would drop what came since (and cut an input method's text).
                    let typing = focused == Some(Retained::as_ptr(view) as *const AnyObject);
                    if !typing && view.string().to_string() != *value {
                        view.setString(&NSString::from_str(value));
                    }
                    paint_mentions(view, handles);
                }
                (SheetRow::Text { value, hint, .. }, Control::Text { field }) => {
                    // Being typed in (its field editor has the focus): as the text view above.
                    if field.currentEditor().is_none() && field.stringValue().to_string() != *value {
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
                        fill_popup(button, options, value, mtm);
                        *values = options.iter().map(|o| o.value.clone()).collect();
                        *had = options.clone();
                    } else if let Some(at) = values.iter().position(|v| v == value) {
                        button.selectItemWithTag(at as isize);
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
                (SheetRow::Cards { value, options, .. }, Control::Cards { cards, values }) => {
                    for (card, option) in cards.iter().zip(options) {
                        card.name.setStringValue(&NSString::from_str(&option.label));
                        if let (Some(line), Some(h)) = (&card.line, option.hint.as_deref()) {
                            line.setStringValue(&NSString::from_str(h));
                        }
                        style_card(card, option.value == *value);
                    }
                    *values = options.iter().map(|o| o.value.clone()).collect();
                }
                (SheetRow::Callout { text: words, detail: more }, Control::Callout { text, detail, .. }) => {
                    text.setStringValue(&NSString::from_str(words));
                    if let (Some(d), Some(m)) = (detail, more) {
                        d.setStringValue(&NSString::from_str(m));
                    }
                }
                (SheetRow::Button { text, hint, .. }, Control::Button { button }) => {
                    button.setTitle(&NSString::from_str(text));
                    if let (Some(h), Some(line)) = (hint, &built.line) {
                        line.setStringValue(&NSString::from_str(h));
                    }
                }
                (SheetRow::Checkbox { text, checked, hint, disabled, .. }, Control::Checkbox { button }) => {
                    button.setTitle(&NSString::from_str(text));
                    button.setEnabled(!*disabled);
                    button.setState(if *checked { NSControlStateValueOn } else { NSControlStateValueOff });
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
        // Light or dark as the page is (its own setting may differ from the Mac's), on its sheet colour,
        // the main button in its accent. No palette: the Mac's own, as before.
        let look = spec.palette.as_ref().and_then(|p| NSAppearance::appearanceNamed(if p.dark { unsafe { NSAppearanceNameDarkAqua } } else { unsafe { NSAppearanceNameAqua } }));
        sheet.panel.setAppearance(look.as_deref());
        match colour(|p| &p.surface) {
            Some(surface) => sheet.panel.setBackgroundColor(Some(&surface)),
            None => sheet.panel.setBackgroundColor(Some(&NSColor::windowBackgroundColor())),
        }
        sheet.submit.setBezelColor(colour(|p| &p.accent).as_deref());
        sheet.title.setStringValue(&NSString::from_str(&spec.title));
        sheet.intro.setStringValue(&NSString::from_str(spec.intro.as_deref().unwrap_or("")));
        sheet.cancel.setTitle(&NSString::from_str(&spec.cancel));
        sheet.submit.setTitle(&NSString::from_str(&spec.submit));
        sheet.submit.setEnabled(spec.can_submit && !spec.busy);
        sheet.submit_cmd.setEnabled(spec.can_submit && !spec.busy);
        sheet.cancel.setEnabled(!spec.busy);
        if let (Some(button), Some(a)) = (&sheet.aside, &spec.aside) {
            button.setTitle(&NSString::from_str(&a.label));
            button.setEnabled(!spec.busy);
        }
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

    /// Opens the sheet on `parent`: its id, which its updates and close carry, or none.
    pub fn open(parent: *mut std::ffi::c_void, spec: SheetSpec, emit: Box<dyn Fn(SheetEvent)>) -> Option<u64> {
        let mtm = MainThreadMarker::new()?;
        close(None);
        PALETTE.with(|p| *p.borrow_mut() = spec.palette.clone());
        // SAFETY: the app's own window, read on this thread just now; alive while it's open.
        let parent = unsafe { parent.cast::<NSWindow>().as_ref() }?;
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

        let aside = spec.aside.as_ref().map(|a| {
            let button = unsafe { NSButton::buttonWithTitle_target_action(&NSString::from_str(&a.label), Some(&controller), Some(sel!(changed:)), mtm) };
            button.setTag(ASIDE_TAG);
            root.addSubview(&button);
            button
        });
        let rows = build_rows(&spec, &root, &controller, mtm);
        let shape = spec.rows.iter().map(SheetRow::shape).collect();
        let id = NEXT_ID.with(|n| {
            n.set(n.get() + 1);
            n.get()
        });
        let sheet = Sheet { id, parent: parent.clone(), panel: panel.clone(), root, controller, spec, shape, title, intro, rows, footer, aside, error, cancel, submit, submit_cmd, emit };
        apply_chrome(&sheet);
        layout(&sheet);
        focus_first(&sheet);
        SHEET.with(|s| *s.borrow_mut() = Some(sheet));
        parent.beginSheet_completionHandler(&panel, None);
        Some(id)
    }

    pub fn update(id: u64, spec: SheetSpec) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        SHEET.with(|s| {
            let Ok(mut s) = s.try_borrow_mut() else { return };
            let Some(sheet) = s.as_mut().filter(|sheet| sheet.id == id) else { return };
            let recoloured = spec.palette != sheet.spec.palette;
            PALETTE.with(|p| *p.borrow_mut() = spec.palette.clone());
            let shape: Vec<String> = spec.rows.iter().map(SheetRow::shape).collect();
            // New colours: build the rows again, so every card and callout takes them.
            let rebuilt = shape != sheet.shape || recoloured;
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
                        Control::Checkbox { button } | Control::Button { button } => button.removeFromSuperview(),
                        Control::Cards { cards, .. } => {
                            for c in cards {
                                c.boxed.removeFromSuperview();
                                c.hit.removeFromSuperview();
                            }
                        }
                        Control::Callout { boxed, .. } => boxed.removeFromSuperview(),
                        Control::Note => {}
                    }
                }
                sheet.rows = build_rows(&spec, &sheet.root, &sheet.controller, mtm);
                sheet.shape = shape;
            } else {
                update_in_place(sheet, &spec, mtm);
            }
            sheet.spec = spec;
            apply_chrome(sheet);
            layout(sheet);
            if rebuilt {
                focus_first(sheet);
            }
        });
    }

    /// Closes the sheet `id` (none: whichever is open).
    pub fn close(id: Option<u64>) {
        let sheet = SHEET.with(|s| {
            let mut s = s.try_borrow_mut().ok()?;
            if id.is_some_and(|id| s.as_ref().is_some_and(|sheet| sheet.id != id)) {
                return None;
            }
            s.take()
        });
        if let Some(sheet) = sheet {
            sheet.parent.endSheet(&sheet.panel);
            sheet.panel.orderOut(None);
        }
    }
}

/// Opens the form as a sheet on the window; its changes come back as `native-sheet` events.
#[tauri::command]
pub async fn native_sheet_open(window: tauri::Window, spec: SheetSpec) -> Result<Option<u64>, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::Emitter;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let to = window.clone();
        let on = window.clone();
        window
            .run_on_main_thread(move || {
                let emit: Box<dyn Fn(SheetEvent)> = Box::new(move |event| {
                    let _ = to.emit("native-sheet", event);
                });
                // The window's own pointer, read here on the main thread, where it's used.
                let opened = on.ns_window().ok().and_then(|ns| mac::open(ns, spec, emit));
                let _ = tx.send(opened);
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, spec);
        Ok(None)
    }
}

/// The form again, as it is now (the page's state changed).
#[tauri::command]
pub async fn native_sheet_update(window: tauri::Window, id: u64, spec: SheetSpec) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window.run_on_main_thread(move || mac::update(id, spec)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (window, id, spec);
    Ok(())
}

/// Closes the sheet (submitted, cancelled, or the page gave up on it).
#[tauri::command]
pub async fn native_sheet_close(window: tauri::Window, id: u64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window.run_on_main_thread(move || mac::close(Some(id))).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (window, id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The form as lib/native-sheet.ts sends it (its `wire`): every kind of row, a footer, a picture.
    #[test]
    fn takes_the_page_s_colours_and_draws_in_the_mac_s_without_them() {
        let json = r##"{ "title": "How It Runs", "rows": [], "cancel": "Cancel", "submit": "Switch", "canSubmit": false,
            "palette": { "dark": false, "accent": "#3b82f6", "bg": "#ffffff", "surface": "#f8f9fb" } }"##;
        let spec: SheetSpec = serde_json::from_str(json).expect("the page's form");
        let p = spec.palette.expect("its colours");
        assert!(!p.dark);
        assert_eq!(rgb_of(&p.accent), Some((59.0 / 255.0, 130.0 / 255.0, 246.0 / 255.0)));
        assert_eq!(rgb_of(&p.bg), Some((1.0, 1.0, 1.0)));
        // An older page sends none: the sheet keeps the Mac's own light/dark and accent.
        let old: SheetSpec = serde_json::from_str(r#"{ "title": "T", "rows": [], "cancel": "C", "submit": "S", "canSubmit": true }"#).expect("form");
        assert!(old.palette.is_none());
        for bad in ["", "3b82f6", "#3b82f", "#3b82f6ff", "#zzzzzz", "#é3b82f"] {
            assert_eq!(rgb_of(bad), None, "{bad}");
        }
    }

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
    fn reads_a_field_s_rules_as_the_page_writes_them() {
        let row: SheetRow = serde_json::from_str(r#"{ "kind": "text", "id": "prefix", "value": "", "maxLength": 6, "upper": true, "keep": "AB" }"#).unwrap();
        assert!(matches!(row, SheetRow::Text { max_length: Some(6), upper: true, ref keep, .. } if keep.as_deref() == Some("AB")));
        let area: SheetRow = serde_json::from_str(r#"{ "kind": "textarea", "id": "goal", "value": "", "maxLength": 8000 }"#).unwrap();
        assert!(matches!(area, SheetRow::TextArea { max_length: Some(8000), .. }));
        let check: SheetRow = serde_json::from_str(r#"{ "kind": "checkbox", "id": "repo:a", "text": "a", "checked": true, "disabled": true }"#).unwrap();
        assert!(matches!(check, SheetRow::Checkbox { disabled: true, .. }));
    }

    #[test]
    fn a_field_takes_what_its_rules_allow_as_you_type() {
        assert_eq!(filtered("ln-x", Some(6), true, Some("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")), "LNX");
        assert_eq!(filtered("ABCDEFGH", Some(6), true, None), "ABCDEF");
        assert_eq!(filtered("名字很长的工作树", Some(4), false, None), "名字很长");
        assert_eq!(filtered("as is", None, false, None), "as is");
    }

    #[test]
    fn says_what_changed_as_the_page_reads_it() {
        let json = serde_json::to_value(SheetEvent::Change { id: "priority".into(), value: "high".into() }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "change", "id": "priority", "value": "high" }));
        assert_eq!(serde_json::to_value(SheetEvent::Submit).unwrap(), serde_json::json!({ "kind": "submit" }));
    }
}
