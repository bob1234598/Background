// Muse input bar and reply bubble. Uses sendMessage() from muse.js.
(() => {
  const root = document.getElementById("muse");
  const form = document.getElementById("muse-form");
  const input = document.getElementById("muse-input");
  const sendBtn = document.getElementById("muse-send");
  const bubble = document.getElementById("muse-bubble");
  const closeBtn = document.getElementById("muse-close");
  const questionEl = document.getElementById("muse-question");
  const replyEl = document.getElementById("muse-reply");

  // Conversation lives in memory only; it's gone when the tab closes.
  const history = [];
  let pending = false;

  const isOpen = () => bubble.classList.contains("is-open");

  function setOpen(open) {
    bubble.classList.toggle("is-open", open);
    bubble.inert = !open;
  }

  function updateSendState() {
    sendBtn.disabled = pending || input.value.trim() === "";
  }

  function showExchange(question, reply, state) {
    questionEl.textContent = question;
    replyEl.textContent = reply;
    replyEl.classList.toggle("is-pending", state === "pending");
    replyEl.classList.toggle("is-error", state === "error");
    bubble.scrollTop = 0;
    setOpen(true);
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || pending) return;

    pending = true;
    input.value = "";
    updateSendState();

    history.push({ role: "user", content: text });
    showExchange(text, "Thinking…", "pending");

    try {
      // Pass a copy so the backend can't mutate our history.
      const reply = await sendMessage(history.slice());
      history.push({ role: "assistant", content: reply });
      showExchange(text, reply);
    } catch (err) {
      // Drop the failed turn so the next message doesn't carry it.
      history.pop();
      showExchange(text, "Something went wrong. Please try again.", "error");
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
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      setOpen(false);
    }
  });
  input.addEventListener("keyup", (event) => event.stopPropagation());
  input.addEventListener("keypress", (event) => event.stopPropagation());

  closeBtn.addEventListener("click", () => {
    setOpen(false);
    input.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) setOpen(false);
  });

  // Clicking anywhere outside the bubble and bar closes the bubble.
  document.addEventListener("pointerdown", (event) => {
    if (isOpen() && !root.contains(event.target)) setOpen(false);
  });
})();
