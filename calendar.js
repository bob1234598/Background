// "Today" card: today's events from the primary Google Calendar.
(() => {
  const body = document.getElementById("today-body");

  const CACHE_KEY = "calendarCache";
  const STALE_MS = 5 * 60 * 1000;
  const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  let events = null; // normalized events for today + tomorrow, or null if not loaded
  let fetchedAt = 0;
  let refreshing = false;

  // ---------- Dates ----------
  const startOfDay = (date, offsetDays = 0) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);

  // All-day dates ("2026-10-01") are local calendar days, not UTC midnight.
  function parseDay(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function countdown(event, now) {
    if (event.start <= now) return "now";
    const mins = Math.ceil((event.start - now) / 60000);
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }

  // ---------- Data ----------
  const declined = (item) =>
    (item.attendees || []).some((a) => a.self && a.responseStatus === "declined");

  function normalize(item) {
    const allDay = Boolean(item.start.date);
    return {
      id: item.id,
      title: item.summary || "(No title)",
      allDay,
      // Stored as epoch ms so the cache round-trips through JSON.
      start: (allDay ? parseDay(item.start.date) : new Date(item.start.dateTime)).getTime(),
      end: (allDay ? parseDay(item.end.date) : new Date(item.end.dateTime)).getTime(),
      link: item.htmlLink,
    };
  }

  async function fetchEvents(interactive) {
    const now = new Date();
    const params = new URLSearchParams({
      timeMin: startOfDay(now).toISOString(),
      timeMax: startOfDay(now, 2).toISOString(), // through the end of tomorrow
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
    });
    const data = await Google.request(`${EVENTS_URL}?${params}`, { interactive });
    return (data.items || [])
      .filter((item) => item.status !== "cancelled" && item.start && !declined(item))
      .map(normalize);
  }

  function partition(now) {
    const today = startOfDay(new Date(now)).getTime();
    const tomorrow = startOfDay(new Date(now), 1).getTime();
    const dayAfter = startOfDay(new Date(now), 2).getTime();
    const isToday = (e) => e.start < tomorrow && e.end > today;

    const allDay = events.filter((e) => e.allDay && isToday(e));
    const timed = events
      .filter((e) => !e.allDay && isToday(e))
      .sort((a, b) => a.start - b.start);

    // First event of tomorrow, preferring a timed one over all-day.
    const next = events
      .filter((e) => e.start >= tomorrow && e.start < dayAfter)
      .sort((a, b) => a.allDay - b.allDay || a.start - b.start)[0];

    // Highlight the event happening now, else the next one today.
    const focus =
      timed.find((e) => e.start <= now && now < e.end) || timed.find((e) => e.start > now);

    return { today, allDay, timed, next, focus };
  }

  // ---------- Storage ----------
  const saveCache = () => Store.set(CACHE_KEY, { events, fetchedAt });
  const clearCache = () => Store.remove(CACHE_KEY);

  // ---------- Rendering ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function eventLink(event, className) {
    const a = el("a", className);
    a.href = event.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }

  function renderMessage(text, className = "card__empty") {
    body.replaceChildren(el("p", className, text));
  }

  function renderConnect(error) {
    const wrap = el("div", "card__connect");
    wrap.append(el("p", "card__empty", "Connect your Google account to see today's events."));

    const button = el("button", "card__button", "Connect Google");
    button.type = "button";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Connecting…";
      await refresh(true);
    });
    wrap.append(button);

    if (error) wrap.append(el("p", "card__error", error));
    body.replaceChildren(wrap);
  }

  function render() {
    if (!events) return;
    const now = Date.now();
    const { today, allDay, timed, next, focus } = partition(now);

    const list = el("ul", "cal");

    for (const event of allDay) {
      const a = eventLink(event, "cal__event cal__event--allday");
      a.append(el("span", "cal__time", "All day"), el("span", "cal__title", event.title));
      const li = el("li");
      li.append(a);
      list.append(li);
    }

    for (const event of timed) {
      const classes = ["cal__event"];
      if (event === focus) classes.push("is-focus");
      else if (event.end <= now) classes.push("is-past");

      const a = eventLink(event, classes.join(" "));
      // Events that started yesterday show when they end instead.
      const time =
        event.start < today
          ? `until ${timeFormat.format(event.end)}`
          : timeFormat.format(event.start);
      a.append(el("span", "cal__time", time), el("span", "cal__title", event.title));
      if (event === focus) a.append(el("span", "cal__countdown", countdown(event, now)));

      const li = el("li");
      li.append(a);
      list.append(li);
    }

    const nodes = [];
    if (allDay.length || timed.length) {
      nodes.push(list);
    } else {
      nodes.push(el("p", "card__empty", "Nothing scheduled today."));
    }

    if (next) {
      const a = eventLink(next, "cal__next");
      const when = next.allDay ? "Tomorrow" : `Tomorrow ${timeFormat.format(next.start)}`;
      a.append(
        el("span", "cal__next-label", "Next:"),
        el("span", "cal__next-when", when),
        el("span", "cal__title", next.title)
      );
      nodes.push(a);
    }

    body.replaceChildren(...nodes);

    // If the list scrolls, start it at the highlighted event (scrolls the list only).
    const focused = list.querySelector(".is-focus");
    if (focused && list.scrollHeight > list.clientHeight) {
      list.scrollTop = Math.max(0, focused.offsetTop - 8);
    }
  }

  // Periodic update. While an event link has keyboard focus, only update the
  // countdown text so focus isn't lost by rebuilding the list.
  function tick() {
    if (!events) return;
    if (!body.contains(document.activeElement)) return render();
    const now = Date.now();
    const { focus } = partition(now);
    const label = body.querySelector(".cal__countdown");
    if (focus && label) label.textContent = countdown(focus, now);
  }

  // ---------- Refresh ----------
  async function refresh(interactive = false) {
    if (refreshing) return;
    refreshing = true;
    try {
      events = await fetchEvents(interactive);
      fetchedAt = Date.now();
      saveCache();
      render();
    } catch (err) {
      if (err instanceof Google.AuthError) {
        events = null;
        clearCache();
        renderConnect(interactive ? "Couldn't connect. Please try again." : "");
      } else if (!events) {
        renderMessage(`Couldn't load your calendar. ${err.message}`, "card__error");
      }
      // With cached events on screen, keep showing them and try again later.
      if (!(err instanceof Google.AuthError)) console.warn("Calendar:", err);
    } finally {
      refreshing = false;
    }
  }

  async function init() {
    const cached = await Store.get(CACHE_KEY);
    if (cached && Array.isArray(cached.events)) {
      events = cached.events;
      fetchedAt = cached.fetchedAt || 0;
      render();
    } else {
      renderMessage("Loading…");
    }
    refresh(false);
  }

  // Update every 30s so countdowns, highlights and the day roll over.
  setInterval(tick, 30 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    render();
    if (Date.now() - fetchedAt > STALE_MS) refresh(false);
  });

  window.addEventListener("online", () => refresh(false));

  // Signed in from another card: load events if we're showing "Connect".
  window.addEventListener(Google.SIGNED_IN, () => {
    if (!events) refresh(false);
  });

  init();
})();
