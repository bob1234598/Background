// Muse input bar. Sending is delegated to Muse.sendMessage() in muse.js.
(() => {
  const form = document.getElementById("muse-form");
  const input = document.getElementById("muse-input");
  const sendBtn = document.getElementById("muse-send");
  const hint = document.getElementById("muse-hint");

  const HINT_MS = 4000;
  let pending = false;
  let hintTimer = 0;

  function updateSendState() {
    sendBtn.disabled = pending || input.value.trim() === "";
  }

  function showHint(text) {
    hint.textContent = text;
    hint.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove("is-visible"), HINT_MS);
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || pending) return;

    pending = true;
    updateSendState();
    try {
      const result = (await Muse.sendMessage(text)) || {};
      if (!result.keepText) input.value = "";
      if (result.hint) showHint(result.hint);
    } catch (err) {
      showHint("Couldn't send to Muse");
      console.error("Muse:", err);
    } finally {
      pending = false;
      updateSendState();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener("input", updateSendState);

  // Keep keystrokes in the bar from reaching any page-level shortcuts.
  for (const type of ["keydown", "keyup", "keypress"]) {
    input.addEventListener(type, (event) => event.stopPropagation());
  }
})();
