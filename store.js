// chrome.storage.local wrapper that never throws (e.g. when opened outside the extension).
const Store = (() => {
  const area = typeof chrome !== "undefined" && chrome.storage ? chrome.storage.local : null;

  return {
    async get(key) {
      if (!area) return undefined;
      try {
        return (await area.get(key))[key];
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      area?.set({ [key]: value }).catch(() => {});
    },
    remove(key) {
      area?.remove(key).catch(() => {});
    },
  };
})();
