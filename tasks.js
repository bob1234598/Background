// "Tasks" card: incomplete tasks from a Google Tasks list.
(() => {
  const content = document.getElementById("tasks-content");
  const selectWrap = document.getElementById("tasks-select");
  const select = document.getElementById("tasks-list");
  const form = document.getElementById("tasks-form");
  const input = document.getElementById("tasks-input");
  const errorEl = document.getElementById("tasks-error");

  const API = "https://tasks.googleapis.com/tasks/v1";
  const CACHE_KEY = "tasksCache";
  const LIST_KEY = "tasksListId"; // chosen list; kept even after signing out
  const STALE_MS = 5 * 60 * 1000;
  const DONE_DELAY_MS = 900; // how long a checked task lingers before fading
  const FADE_MS = 400;       // must match the .task.is-leaving transition

  let lists = [];       // [{ id, title }]
  let listId = null;    // selected list
  let tasks = null;     // normalized tasks for listId, or null when signed out / not loaded
  let fetchedAt = 0;
  let version = 0;      // ignores responses from superseded refreshes
  let switching = false; // a newly selected list is loading
  let revealId = null;   // task to scroll into view on the next render
  const completing = new Set(); // task ids checked but not yet removed

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const jsonInit = (method, data) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  // ---------- Due dates ----------
  const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const shortDateYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });

  // Tasks stores due dates as midnight UTC; only the date part is meaningful.
  function dueInfo(due) {
    const [y, m, d] = due.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((date - today) / 86400000);

    let label;
    if (days === 0) label = "Today";
    else if (days === 1) label = "Tomorrow";
    else if (days === -1) label = "Yesterday";
    else if (days > 1 && days < 7) label = weekday.format(date);
    else label = (y === now.getFullYear() ? shortDate : shortDateYear).format(date);

    return { label, overdue: days < 0 };
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

  const listUrl = (id) => `${API}/lists/${encodeURIComponent(id)}/tasks`;

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

    return { lists: allLists, listId: id, tasks: order(items) };
  }

  // ---------- Rendering ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  let errorTimer = 0;
  function flashError(text) {
    errorEl.textContent = text;
    errorEl.hidden = false;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => (errorEl.hidden = true), 4000);
  }

  function setConnected(connected) {
    form.hidden = !connected;
    selectWrap.hidden = !connected || lists.length === 0;
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

  function renderTask(task) {
    const done = completing.has(task.id);
    const li = el("li", "task");
    li.dataset.id = task.id;
    if (task.sub) li.classList.add("task--sub");
    if (done) li.classList.add("is-done");
    if (task.saving) li.classList.add("is-saving");

    const label = el("label", "task__label");
    const check = el("input", "task__check");
    check.type = "checkbox";
    check.checked = done;
    check.disabled = done || task.saving;
    check.setAttribute("aria-label", `Complete "${task.title || "untitled task"}"`);
    check.addEventListener("change", () => complete(task, li, check));

    const title = el("span", "task__title", task.title || "(No title)");
    if (!task.title) title.classList.add("is-untitled");
    label.append(check, title);
    li.append(label);

    if (task.due) {
      const { label: dueText, overdue } = dueInfo(task.due);
      const due = el("span", "task__due", dueText);
      if (overdue) due.classList.add("is-overdue");
      li.append(due);
    }
    return li;
  }

  function render() {
    if (!tasks) return;
    setConnected(true);
    renderSelect();

    if (tasks.length === 0) {
      content.replaceChildren(el("p", "card__empty", "Nothing on your list. Enjoy the quiet."));
      return;
    }
    const ul = el("ul", "tasks");
    ul.append(...tasks.map(renderTask));
    content.replaceChildren(ul);

    // Scroll the list (not the page) so a just-added task is visible.
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
    Store.set(CACHE_KEY, { lists, listId, tasks: tasks.filter((t) => !t.saving), fetchedAt });

  // ---------- Actions ----------
  function handleAuthError() {
    tasks = null;
    Store.remove(CACHE_KEY);
    renderConnect("");
  }

  async function complete(task, li, check) {
    completing.add(task.id);
    li.classList.add("is-done");
    check.disabled = true;

    try {
      await Promise.all([
        Google.request(`${listUrl(listId)}/${encodeURIComponent(task.id)}`, jsonInit("PATCH", { status: "completed" })),
        wait(DONE_DELAY_MS),
      ]);
      // The list may have re-rendered meanwhile; fade whichever element shows it now.
      content.querySelector(`[data-id="${CSS.escape(task.id)}"]`)?.classList.add("is-leaving");
      await wait(FADE_MS);
      // Re-order so any subtasks of a completed parent move to the top level.
      if (tasks) tasks = order(tasks.filter((t) => t.id !== task.id));
      completing.delete(task.id);
      saveCache();
      render();
    } catch (err) {
      completing.delete(task.id);
      if (err instanceof Google.AuthError) return handleAuthError();
      render();
      flashError("Couldn't complete that task. Please try again.");
      console.warn("Tasks:", err);
    }
  }

  async function addTask(title) {
    const targetList = listId;
    // Empty position sorts first among undated tasks, where Google puts new ones.
    const temp = { id: `temp-${Date.now()}`, title, due: null, parent: null, position: "", saving: true };
    tasks = order([temp, ...tasks]);
    revealId = temp.id;
    render();

    try {
      const created = normalize(
        await Google.request(listUrl(targetList), jsonInit("POST", { title }))
      );
      if (tasks && listId === targetList) {
        tasks = order(
          tasks.filter((t) => t.id !== created.id).map((t) => (t.id === temp.id ? created : t))
        );
        saveCache();
        render();
      }
    } catch (err) {
      if (tasks) tasks = tasks.filter((t) => t.id !== temp.id);
      if (err instanceof Google.AuthError) return handleAuthError();
      render();
      if (!input.value) input.value = title; // give the text back
      flashError("Couldn't add that task. Please try again.");
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
      // Keep tasks that are still being added so they don't flicker away.
      const saving = (tasks || []).filter((t) => t.saving);
      tasks = order([...saving, ...data.tasks]);
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
    content.replaceChildren(el("p", "card__empty", "Loading…"));
    refresh(false);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title || !tasks) return;
    input.value = "";
    addTask(title);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (tasks) render(); // due labels roll over at midnight
    if (Date.now() - fetchedAt > STALE_MS) refresh(false);
  });

  window.addEventListener("online", () => refresh(false));

  window.addEventListener(Google.SIGNED_IN, () => {
    if (!tasks) refresh(false);
  });

  // ---------- Start ----------
  async function init() {
    const [cached, savedList] = await Promise.all([Store.get(CACHE_KEY), Store.get(LIST_KEY)]);
    listId = savedList || null;

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

  init();
})();
