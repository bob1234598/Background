// "Tasks" card: incomplete tasks from a Google Tasks list.
(() => {
  const card = document.getElementById("tasks-card");
  const content = document.getElementById("tasks-content");
  const toggle = document.getElementById("tasks-toggle");
  const selectWrap = document.getElementById("tasks-select");
  const select = document.getElementById("tasks-list");
  const form = document.getElementById("tasks-form");
  const input = document.getElementById("tasks-input");
  const toast = document.getElementById("tasks-toast");
  const toastText = document.getElementById("tasks-toast-text");
  const toastUndo = document.getElementById("tasks-toast-undo");

  const API = "https://tasks.googleapis.com/tasks/v1";
  const CACHE_KEY = "tasksCache";
  const LIST_KEY = "tasksListId";     // chosen list; kept even after signing out
  const RANGE_KEY = "tasksRange";
  const SHOW_ALL_KEY = "tasksShowAll"; // legacy week/all toggle, read once to migrate
  const STALE_MS = 5 * 60 * 1000;
  // Views the header button cycles through, in order. `days` is how far ahead
  // a task may be due (overdue tasks always show); null = everything, dated or not.
  const RANGES = [
    { id: "day", days: 0, label: "Today", hint: "Showing tasks due today", empty: "Nothing due today." },
    { id: "week", days: 7, label: "This week", hint: "Showing tasks due within a week", empty: "Nothing due this week." },
    { id: "month", days: 30, label: "This month", hint: "Showing tasks due within a month", empty: "Nothing due this month." },
    { id: "all", days: null, label: "All tasks", hint: "Showing all tasks", empty: "Nothing on your list. Enjoy the quiet." },
  ];
  const DEFAULT_RANGE = "week";
  const DONE_DELAY_MS = 900; // how long a checked task lingers before fading
  const FADE_MS = 400;       // must match the .task.is-leaving transition
  const TOAST_MS = 3000;
  const TOAST_RESUME_MS = 1500; // after the pointer or focus leaves the toast

  let lists = [];       // [{ id, title }]
  let listId = null;    // selected list
  let tasks = null;     // normalized tasks for listId, or null when signed out / not loaded
  let range = RANGES.find((r) => r.id === DEFAULT_RANGE);
  let fetchedAt = 0;
  let version = 0;      // ignores responses from superseded refreshes
  let switching = false; // a newly selected list is loading
  let revealId = null;   // task to scroll into view on the next render

  const completing = new Set(); // checked on screen, not yet faded out
  // Local changes Google hasn't confirmed yet, re-applied over refreshed data
  // so a background refresh can't undo what's on screen.
  const pendingHide = new Set(); // completed or deleted locally
  const pendingShow = new Map(); // restored locally (undo): id -> task

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const jsonInit = (method, data) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  // ---------- Dates ----------
  // Google Tasks stores only a date ("2026-10-01T00:00:00.000Z"); the date part
  // is the user's intended day. Compare it as a string against *local* dates,
  // never by converting it to a Date (that would shift it a day west of UTC).
  const pad = (n) => String(n).padStart(2, "0");
  function localDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const shortDateYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });

  function dueLabel(due) {
    const [y, m, d] = due.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((date - today) / 86400000);

    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    if (days > 1 && days < 7) return weekday.format(date);
    return (y === now.getFullYear() ? shortDate : shortDateYear).format(date);
  }

  // ---------- Data ----------
  function normalize(item) {
    return {
      id: item.id,
      title: item.title || "",
      due: item.due ? item.due.slice(0, 10) : null,
      parent: item.parent || null,
      position: item.position || "",
    };
  }

  // Sort by due date (earliest first, undated last), then by Google's own order.
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  function byDate(a, b) {
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return compare(a.due, b.due);
    }
    return compare(a.position, b.position);
  }

  // Top-level tasks by date, each followed by its subtasks (also by date).
  // A subtask whose parent isn't in `items` is shown at the top level.
  function order(items) {
    const ids = new Set(items.map((t) => t.id));
    const top = items.filter((t) => !t.parent || !ids.has(t.parent)).sort(byDate);
    const out = [];
    for (const t of top) {
      out.push({ ...t, sub: false });
      items
        .filter((c) => c.parent === t.id)
        .sort(byDate)
        .forEach((c) => out.push({ ...c, sub: true }));
    }
    return out;
  }

  function applyPending(items) {
    const out = items.filter((t) => !pendingHide.has(t.id));
    for (const [id, task] of pendingShow) {
      if (!out.some((t) => t.id === id)) out.push(task);
    }
    return out;
  }

  const listUrl = (list) => `${API}/lists/${encodeURIComponent(list)}/tasks`;
  const taskUrl = (list, id) => `${listUrl(list)}/${encodeURIComponent(id)}`;

  async function fetchData(interactive) {
    const data = await Google.request(`${API}/users/@me/lists?maxResults=100`, { interactive });
    const allLists = (data.items || []).map((l) => ({ id: l.id, title: l.title }));

    let id = listId;
    if (!allLists.some((l) => l.id === id)) {
      // Saved list is gone (or none chosen yet): use the default list.
      const fallback = await Google.request(`${API}/users/@me/lists/@default`, { interactive });
      id = fallback.id;
    }

    const params = new URLSearchParams({ showCompleted: "false", showHidden: "false", maxResults: "100" });
    const result = await Google.request(`${listUrl(id)}?${params}`, { interactive });
    const items = (result.items || []).filter((t) => t.status === "needsAction").map(normalize);

    return { lists: allLists, listId: id, tasks: items };
  }

  // ---------- Toast ----------
  let toastTimer = 0;
  let toastAction = null; // undo callback for the most recent action, if any

  function showToast(text, undo = null, { error = false } = {}) {
    toastText.textContent = text;
    toastAction = undo;
    toast.classList.toggle("has-undo", Boolean(undo));
    toast.classList.toggle("is-error", error);
    toast.classList.add("is-visible");
    toast.inert = false;
    startToastTimer(TOAST_MS);
  }

  function startToastTimer(ms) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastAction = null;
    toast.classList.remove("is-visible");
    toast.inert = true;
  }

  function runUndo() {
    const action = toastAction;
    hideToast();
    action?.();
  }

  // ---------- Rendering ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function setConnected(connected) {
    form.hidden = !connected;
    toggle.hidden = !connected;
    selectWrap.hidden = !connected || lists.length === 0;
    if (!connected) hideToast();
  }

  function renderMessage(text, className = "card__empty") {
    setConnected(false);
    content.replaceChildren(el("p", className, text));
  }

  function renderConnect(error) {
    setConnected(false);
    const wrap = el("div", "card__connect");
    wrap.append(el("p", "card__empty", "Connect your Google account to see your tasks."));

    const button = el("button", "card__button", "Connect Google");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Connecting…";
      await refresh(true);
    });
    wrap.append(button);

    if (error) wrap.append(el("p", "card__error", error));
    content.replaceChildren(wrap);
  }

  let renderedListsKey = "";
  function renderSelect() {
    // Rebuild options only when the lists change, so an open dropdown isn't disturbed.
    const key = JSON.stringify(lists);
    if (key !== renderedListsKey) {
      renderedListsKey = key;
      select.replaceChildren(
        ...lists.map((l) => {
          const option = el("option", null, l.title || "(Untitled list)");
          option.value = l.id;
          return option;
        })
      );
    }
    select.value = listId;
  }

  const nextRange = () => RANGES[(RANGES.indexOf(range) + 1) % RANGES.length];

  function renderToggle() {
    // The button names the current view; a click moves on to the next one.
    toggle.textContent = range.label;
    toggle.title = `${range.hint}. Click for: ${nextRange().label}`;
  }

  function renderTask(task, today) {
    const done = completing.has(task.id);
    const li = el("li", "task");
    li.dataset.id = task.id;
    if (task.sub) li.classList.add("task--sub");
    if (done) li.classList.add("is-done");
    if (task.saving) li.classList.add("is-saving");
    if (task.due && task.due < today) li.classList.add("is-overdue");

    const label = el("label", "task__label");
    const check = el("input", "task__check");
    check.type = "checkbox";
    check.checked = done;
    check.disabled = done || task.saving;
    check.setAttribute("aria-label", `Complete "${task.title || "untitled task"}"`);
    check.addEventListener("change", () => complete(task));

    const title = el("span", "task__title", task.title || "(No title)");
    if (!task.title) title.classList.add("is-untitled");
    label.append(check, title);
    li.append(label);

    if (task.due) li.append(el("span", "task__due", dueLabel(task.due)));
    return li;
  }

  let renderedDay = "";
  function render() {
    if (!tasks) return;
    setConnected(true);
    renderSelect();
    renderToggle();

    const today = localDay(0);
    renderedDay = today;
    const showAll = range.days === null;
    // Ranged views: overdue and due today..today+days (inclusive). Undated tasks are hidden.
    const rangeEnd = showAll ? "" : localDay(range.days);
    const visible = showAll ? tasks : order(tasks.filter((t) => t.due && t.due <= rangeEnd));

    if (visible.length === 0) {
      content.replaceChildren(el("p", "card__empty", range.empty));
      return;
    }
    const ul = el("ul", "tasks");
    ul.append(...visible.map((t) => renderTask(t, today)));
    content.replaceChildren(ul);

    // Scroll the list (not the page) so a just-added or restored task is visible.
    const target = revealId && ul.querySelector(`[data-id="${CSS.escape(revealId)}"]`);
    revealId = null;
    if (target && ul.scrollHeight > ul.clientHeight) {
      const top = target.offsetTop; // .tasks is position: relative
      if (top < ul.scrollTop || top + target.offsetHeight > ul.scrollTop + ul.clientHeight) {
        ul.scrollTop = Math.max(0, top - ul.clientHeight / 2);
      }
    }
  }

  // Tasks still being added aren't cached: they may never reach Google.
  const saveCache = () =>
    tasks && Store.set(CACHE_KEY, { lists, listId, tasks: tasks.filter((t) => !t.saving), fetchedAt });

  // Local edits to the list for `list`; ignored if the user switched lists meanwhile.
  function editTasks(list, fn) {
    if (!tasks || listId !== list) return;
    tasks = order(fn(tasks));
    saveCache();
    render();
  }
  const without = (id) => (items) => items.filter((t) => t.id !== id);
  const withTask = (task) => (items) => [...items.filter((t) => t.id !== task.id), task];

  // ---------- Actions ----------
  function handleAuthError() {
    tasks = null;
    Store.remove(CACHE_KEY);
    renderConnect("");
  }

  function reportError(err, message) {
    if (err instanceof Google.AuthError) return handleAuthError();
    showToast(message, null, { error: true });
    console.warn("Tasks:", err);
  }

  // Complete: instant on screen, synced in the background, undoable.
  function complete(task) {
    const id = task.id;
    const list = listId;
    const op = { undone: false };

    completing.add(id);
    pendingHide.add(id);
    render();

    op.request = Google.request(taskUrl(list, id), jsonInit("PATCH", { status: "completed" }));
    op.request.then(
      () => pendingHide.delete(id),
      (err) => {
        pendingHide.delete(id);
        if (op.undone) return; // undoComplete deals with it
        completing.delete(id);
        editTasks(list, withTask(task)); // Google still has it open
        reportError(err, "Couldn't complete task");
      }
    );

    showToast("Task completed", () => undoComplete(task, list, op));

    // Let the check register, then fade the task out.
    setTimeout(async () => {
      if (!completing.has(id)) return; // undone or failed meanwhile
      content.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("is-leaving");
      await wait(FADE_MS);
      if (!completing.has(id)) return;
      completing.delete(id);
      // Re-order so any subtasks of a completed parent move to the top level.
      editTasks(list, without(id));
    }, DONE_DELAY_MS);
  }

  async function undoComplete(task, list, op) {
    const id = task.id;
    op.undone = true;
    completing.delete(id);
    pendingHide.delete(id);
    pendingShow.set(id, task);
    revealId = id;
    editTasks(list, withTask(task)); // back in its original place, instantly

    // Wait for the completion to land first so the two requests can't race.
    const completedOnGoogle = await op.request.then(() => true, () => false);
    try {
      if (completedOnGoogle) {
        await Google.request(taskUrl(list, id), jsonInit("PATCH", { status: "needsAction", completed: null }));
      }
      pendingShow.delete(id);
    } catch (err) {
      pendingShow.delete(id);
      if (err instanceof Google.AuthError) return handleAuthError();
      // Show whatever state Google actually has.
      const actual = await Google.request(taskUrl(list, id)).catch(() => null);
      if (!actual) refresh(false);
      else if (actual.status === "completed" || actual.deleted) editTasks(list, without(id));
      showToast("Couldn't undo", null, { error: true });
      console.warn("Tasks:", err);
    }
  }

  // Add: instant on screen, synced in the background, undoable (deletes it).
  function addTask(title) {
    const list = listId;
    // In the ranged views, new tasks are due today so they don't vanish.
    const due = range.days === null ? null : localDay(0);
    // Empty position sorts first among same-day tasks, where Google puts new ones.
    const temp = { id: `temp-${Date.now()}`, title, due, parent: null, position: "", saving: true };
    const op = { undone: false };

    tasks = order([temp, ...tasks]);
    revealId = temp.id;
    render();

    const body = due ? { title, due: `${due}T00:00:00.000Z` } : { title };
    op.request = Google.request(listUrl(list), jsonInit("POST", body)).then(normalize);
    op.request.then(
      (created) => {
        op.created = created;
        if (op.undone) return;
        if (tasks && listId === list) tasks = tasks.filter((t) => t.id !== temp.id);
        editTasks(list, withTask(created));
      },
      (err) => {
        if (tasks) {
          tasks = tasks.filter((t) => t.id !== temp.id);
          render();
        }
        if (op.undone) return;
        if (!input.value) input.value = title; // give the text back
        reportError(err, "Couldn't add task");
      }
    );

    showToast("Task added", () => undoAdd(temp, list, op));
  }

  async function undoAdd(temp, list, op) {
    op.undone = true;
    // Remove it from screen right away, whether or not Google has it yet.
    if (op.created) pendingHide.add(op.created.id);
    if (tasks) {
      tasks = tasks.filter((t) => t.id !== temp.id && t.id !== op.created?.id);
      saveCache();
      render();
    }

    let created;
    try {
      created = await op.request;
    } catch {
      return; // never reached Google; nothing to delete
    }

    pendingHide.add(created.id);
    editTasks(list, without(created.id));
    try {
      await Google.request(taskUrl(list, created.id), { method: "DELETE" });
      pendingHide.delete(created.id);
    } catch (err) {
      pendingHide.delete(created.id);
      if (err instanceof Google.AuthError) return handleAuthError();
      editTasks(list, withTask(created)); // still exists on Google
      showToast("Couldn't undo", null, { error: true });
      console.warn("Tasks:", err);
    }
  }

  // ---------- Refresh ----------
  async function refresh(interactive = false) {
    const v = ++version;
    try {
      const data = await fetchData(interactive);
      if (v !== version) return;
      lists = data.lists;
      listId = data.listId;
      // Keep tasks still being added, and local changes Google hasn't confirmed.
      const saving = (tasks || []).filter((t) => t.saving);
      tasks = order(applyPending([...saving, ...data.tasks]));
      fetchedAt = Date.now();
      switching = false;
      saveCache();
      render();
    } catch (err) {
      if (v !== version) return;
      const wasSwitching = switching;
      switching = false;
      if (err instanceof Google.AuthError) {
        handleAuthError();
        if (interactive) renderConnect("Couldn't connect. Please try again.");
      } else {
        const message = `Couldn't load your tasks. ${err.message}`;
        if (!tasks) renderMessage(message, "card__error");
        else if (wasSwitching) content.replaceChildren(el("p", "card__error", message));
        console.warn("Tasks:", err);
      }
    }
  }

  // ---------- Events ----------
  select.addEventListener("change", () => {
    listId = select.value;
    Store.set(LIST_KEY, listId);
    tasks = [];
    switching = true;
    hideToast();
    content.replaceChildren(el("p", "card__empty", "Loading…"));
    refresh(false);
  });

  toggle.addEventListener("click", () => {
    range = nextRange();
    Store.set(RANGE_KEY, range.id);
    render();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title || !tasks) return;
    input.value = "";
    addTask(title);
  });

  toastUndo.addEventListener("click", runUndo);
  // Don't let the toast disappear while the pointer or focus is on it.
  const resumeToast = () => toast.classList.contains("is-visible") && startToastTimer(TOAST_RESUME_MS);
  toast.addEventListener("mouseenter", () => clearTimeout(toastTimer));
  toast.addEventListener("mouseleave", resumeToast);
  toast.addEventListener("focusin", () => clearTimeout(toastTimer));
  toast.addEventListener("focusout", resumeToast);

  // Ctrl+Z / Cmd+Z undoes the last action while the toast offers it,
  // unless the user is typing somewhere (they'd expect text undo there).
  function isTyping(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest("textarea, select, [contenteditable='true'], [contenteditable='']")) return true;
    return target.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(target.type);
  }

  document.addEventListener("keydown", (event) => {
    if (!toastAction || event.key.toLowerCase() !== "z") return;
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    runUndo();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (tasks) render(); // due labels and the week window roll over at midnight
    if (Date.now() - fetchedAt > STALE_MS) refresh(false);
  });

  window.addEventListener("online", () => refresh(false));

  // A tab left open: refresh when stale and roll due labels over at midnight,
  // but not while the user is checking off tasks or has focus in the list.
  setInterval(() => {
    if (document.hidden || !tasks || switching || completing.size) return;
    if (content.contains(document.activeElement)) return;
    if (Date.now() - fetchedAt > STALE_MS) refresh(false);
    else if (localDay(0) !== renderedDay) render();
  }, 60 * 1000);

  window.addEventListener(Google.SIGNED_IN, () => {
    if (!tasks) refresh(false);
  });

  // ---------- Start ----------
  async function init() {
    const [cached, savedList, savedRange, savedShowAll] = await Promise.all([
      Store.get(CACHE_KEY),
      Store.get(LIST_KEY),
      Store.get(RANGE_KEY),
      Store.get(SHOW_ALL_KEY),
    ]);
    listId = savedList || null;
    const rangeId = savedRange || (savedShowAll === true ? "all" : DEFAULT_RANGE);
    range = RANGES.find((r) => r.id === rangeId) || range;

    if (cached && Array.isArray(cached.tasks) && (!listId || cached.listId === listId)) {
      lists = cached.lists || [];
      listId = cached.listId;
      tasks = order(cached.tasks);
      fetchedAt = cached.fetchedAt || 0;
      render();
    } else {
      renderMessage("Loading…");
    }
    refresh(false);
  }

  hideToast();
  init();
})();
