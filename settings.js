// Display settings (clock format, seconds, focus mode, palette) and the gear panel.
// Loaded in <head>: applies the palette and focus mode before first paint.
const Settings = (() => {
  const KEY = "settings";          // source of truth, in chrome.storage.local
  const MIRROR = "settingsMirror"; // synchronous copy in localStorage, for first paint
  const PALETTES = ["midnight", "teal", "burgundy"];
  const DEFAULTS = { hour24: null, seconds: false, focus: false, palette: "midnight" };

  const root = document.documentElement;
  const listeners = new Set();

  // Keep only known keys with valid values, so stale or hand-edited data can't break the page.
  function sanitize(raw) {
    const s = { ...DEFAULTS };
    if (!raw || typeof raw !== "object") return s;
    if (typeof raw.hour24 === "boolean") s.hour24 = raw.hour24;
    if (typeof raw.seconds === "boolean") s.seconds = raw.seconds;
    if (typeof raw.focus === "boolean") s.focus = raw.focus;
    if (PALETTES.includes(raw.palette)) s.palette = raw.palette;
    return s;
  }

  function readMirror() {
    try {
      return JSON.parse(localStorage.getItem(MIRROR));
    } catch {
      return null;
    }
  }

  function writeMirror() {
    try {
      localStorage.setItem(MIRROR, JSON.stringify(current));
    } catch {
      // Storage unavailable; first paint just uses the defaults.
    }
  }

  function apply() {
    root.dataset.palette = current.palette;
    root.toggleAttribute("data-focus", current.focus);
  }

  let current = sanitize(readMirror());
  apply();

  // null means "follow the system"; resolve it from the locale.
  const systemHour24 = () =>
    new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle?.startsWith("h2") ?? false;

  const same = (a, b) => Object.keys(DEFAULTS).every((k) => a[k] === b[k]);

  // Replace the settings; notify listeners only if something changed.
  function update(next, { persist }) {
    next = sanitize(next);
    if (same(next, current)) return;
    current = next;
    apply();
    writeMirror();
    if (persist) Store.set(KEY, current);
    for (const fn of listeners) fn(current);
  }

  // chrome.storage wins over the mirror (which may be stale, e.g. after storage was cleared).
  Store.get(KEY).then((saved) => {
    update(saved ?? DEFAULTS, { persist: false });
    writeMirror();
  });

  // Keep other open new tabs in sync.
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[KEY]) update(changes[KEY].newValue, { persist: false });
    });
  }

  const api = {
    get: () => current,
    hour24: () => current.hour24 ?? systemHour24(),
    set: (patch) => update({ ...current, ...patch }, { persist: true }),
    onChange: (fn) => listeners.add(fn),
    // Intl options so every time on the page follows the 12/24-hour setting.
    timeOptions: () => (current.hour24 == null ? {} : { hourCycle: current.hour24 ? "h23" : "h12" }),
  };

  // ---------- Panel ----------
  function initPanel() {
    const gear = document.getElementById("settings-gear");
    const panel = document.getElementById("settings-panel");
    const form = document.getElementById("settings-form");

    function sync() {
      const s = current;
      form.elements.hour24.value = api.hour24() ? "24" : "12";
      form.elements.seconds.checked = s.seconds;
      form.elements.focus.checked = s.focus;
      form.elements.palette.value = s.palette;
    }

    function open() {
      sync();
      panel.hidden = false;
      gear.setAttribute("aria-expanded", "true");
      form.querySelector("input:checked")?.focus(); // the selected clock format
    }

    function close({ restoreFocus = false } = {}) {
      if (panel.hidden) return;
      panel.hidden = true;
      gear.setAttribute("aria-expanded", "false");
      if (restoreFocus) gear.focus();
    }

    gear.addEventListener("click", () => (panel.hidden ? open() : close()));

    // Save only the field that changed, so the clock keeps following the
    // system 12/24-hour preference until the user picks one.
    form.addEventListener("change", ({ target }) => {
      const read = {
        hour24: () => target.value === "24",
        seconds: () => target.checked,
        focus: () => target.checked,
        palette: () => target.value,
      }[target.name];
      if (read) api.set({ [target.name]: read() });
    });
    form.addEventListener("submit", (event) => event.preventDefault());

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) close({ restoreFocus: true });
    });

    document.addEventListener("pointerdown", (event) => {
      if (!panel.contains(event.target) && !gear.contains(event.target)) close();
    });

    // Close when keyboard focus leaves the panel and the gear.
    panel.addEventListener("focusout", (event) => {
      const to = event.relatedTarget;
      if (to && !panel.contains(to) && to !== gear) close();
    });

    api.onChange(() => {
      if (!panel.hidden) sync();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPanel);
  } else {
    initPanel();
  }

  return api;
})();
