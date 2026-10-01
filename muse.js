// Muse integration. The bar UI (chat.js) only calls Muse.sendMessage(text);
// swap its body for an API call later without touching the UI.
//
// For now it opens muse.ai (the user's signed-in account) in a small popup
// window. muse.ai ignores pre-fill parameters like ?q=, so the message is
// copied to the clipboard for the user to paste.
const Muse = (() => {
  const MUSE_URL = "https://muse.ai/";
  const POPUP_WIDTH = 420;
  const POPUP_HEIGHT = 640;
  const SCREEN_MARGIN = 16;
  // Session storage is shared by all new tabs, so every tab reuses one popup.
  const POPUP_KEY = "musePopupWindowId";

  const session = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.session : null;

  async function existingPopup() {
    try {
      const id = (await session?.get(POPUP_KEY))?.[POPUP_KEY];
      if (id == null) return null;
      return await chrome.windows.get(id); // throws if the window was closed
    } catch {
      return null;
    }
  }

  async function openPopup() {
    const popup = await existingPopup();
    if (popup) {
      await chrome.windows.update(popup.id, { focused: true, state: "normal" });
      return;
    }

    // Bottom-right of the screen this tab is on.
    const { availLeft = 0, availTop = 0, availWidth, availHeight } = window.screen;
    const created = await chrome.windows.create({
      url: MUSE_URL,
      type: "popup",
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      left: Math.max(availLeft, availLeft + availWidth - POPUP_WIDTH - SCREEN_MARGIN),
      top: Math.max(availTop, availTop + availHeight - POPUP_HEIGHT - SCREEN_MARGIN),
      focused: true,
    });
    await session?.set({ [POPUP_KEY]: created.id }).catch(() => {});
  }

  /**
   * Send a message to Muse.
   *
   * @param {string} text  The user's message.
   * @returns {Promise<{ hint?: string, keepText?: boolean }>}
   *   hint: short status to show in the bar; keepText: leave the text in the bar.
   */
  async function sendMessage(text) {
    // Copy first: the clipboard needs this page to still have focus.
    let copied = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      copied = false;
      console.warn("Muse: couldn't copy to clipboard", err);
    }

    try {
      await openPopup();
    } catch (err) {
      console.warn("Muse: couldn't open popup", err);
      return { hint: "Couldn't open Muse", keepText: true };
    }

    return copied
      ? { hint: "Copied — paste into Muse ⌘V" }
      : { hint: "Couldn't copy — Muse is open", keepText: true };
  }

  return { sendMessage };
})();
