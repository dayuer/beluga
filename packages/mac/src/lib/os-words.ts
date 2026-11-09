import { type KeyPlatform, keyPlatform } from './shortcuts-model.js';
import { say } from './late-words.js';

/**
 * The words that name the computer's own parts (BLG-629). The app runs on macOS, Windows and
 * Linux, so Finder, System Settings and the menu bar are a Mac's words only: each here follows the
 * window's platform (keyPlatform; tests pass one in). Pure, no window needed.
 */

/** The file manager: Finder, File Explorer, Files. */
export const fileManager = (p: KeyPlatform = keyPlatform()): string => say(p === 'windows' ? 'common.osWords.fileExplorer' : p === 'linux' ? 'common.osWords.files' : 'common.osWords.finder');

/**
 * The item that shows a file where it is: "Show in Finder", "Show in File Explorer", "Show in
 * Folder" (Linux has no one file manager). With what it shows: "Show Log in Finder", "Show Log in Files".
 */
export const revealLabel = (what?: string, p: KeyPlatform = keyPlatform()): string =>
  what ? say('common.osWords.showWhatIn', { what, app: fileManager(p) }) : p === 'linux' ? say('common.osWords.showInFolder') : say('common.osWords.showIn', { app: fileManager(p) });

/** The item that opens a folder there: "Open in Finder", "Open in File Explorer", "Open Folder". */
export const openFolderLabel = (p: KeyPlatform = keyPlatform()): string => (p === 'linux' ? say('common.osWords.openFolder') : say('common.osWords.openIn', { app: fileManager(p) }));

/** A phrase at the start of a sentence: "This Mac", "Your PC". */
export const upFirst = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

/** The computer in a sentence: "this Mac", "this PC", "this computer". */
export const thisComputer = (p: KeyPlatform = keyPlatform()): string => say(p === 'mac' ? 'common.osWords.thisMac' : p === 'windows' ? 'common.osWords.thisPc' : 'common.osWords.thisComputer');

/** The computer's own word, for "my Mac" or "the PC": Mac, PC, computer. */
export const computerWord = (p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? 'Mac' : p === 'windows' ? 'PC' : 'computer');

/** Yours in a sentence: "your Mac", "your PC", "your computer". */
export const yourComputer = (p: KeyPlatform = keyPlatform()): string => say(p === 'mac' ? 'common.osWords.yourMac' : p === 'windows' ? 'common.osWords.yourPc' : 'common.osWords.yourComputer');

/** The same in a Title Case label ("Delete from This Computer…"): Mac, PC, Computer. */
export const computerTitle = (p: KeyPlatform = keyPlatform()): string => upFirst(computerWord(p));

/** The system's settings app: System Settings on a Mac, Settings elsewhere. */
export const systemSettingsName = (p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? say('common.osWords.systemSettings') : say('common.osWords.settings'));

/** The system by name: macOS, Windows, Linux. */
export const osName = (p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? 'macOS' : p === 'windows' ? 'Windows' : 'Linux');

/** Where the whale sits: the Menu Bar on a Mac, the System Tray elsewhere (a title; lower-case it in a sentence). */
export const trayName = (p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? say('common.osWords.menuBar') : say('common.osWords.systemTray'));

/** Where the app's icon and its badge sit: the Dock, the taskbar, the dock. */
export const dockName = (p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? say('common.osWords.dock') : p === 'windows' ? say('common.osWords.taskbar') : say('common.osWords.dockLinux'));

/** The Return key as the keyboard names it: Return on a Mac, Enter elsewhere. */
export const returnName = (p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? 'Return' : 'Enter');

/** The main modifier and Return in words: "⌘Return" ("⌘ Return" with a space), "Ctrl+Enter". */
export const cmdReturn = (space = '', p: KeyPlatform = keyPlatform()): string => (p === 'mac' ? `⌘${space}Return` : 'Ctrl+Enter');

/** Where Beluga's notifications are allowed. */
export const notificationSettings = (p: KeyPlatform = keyPlatform()): string =>
  p === 'mac' ? say('common.osWords.notifMac') : p === 'windows' ? say('common.osWords.notifWindows') : say('common.osWords.notifLinux');

/** Where Beluga is let use the microphone. */
export const microphoneSettings = (p: KeyPlatform = keyPlatform()): string =>
  p === 'mac' ? say('common.osWords.micMac') : p === 'windows' ? say('common.osWords.micWindows') : say('common.osWords.micLinux');
