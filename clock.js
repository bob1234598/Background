// Clock, date and time-of-day greeting.
(() => {
  const timeEl = document.getElementById("time");
  const dateEl = document.getElementById("date");
  const greetingEl = document.getElementById("greeting");

  let timeFormat = null;
  let showSeconds = false;
  let timer = 0;

  function configure() {
    showSeconds = Settings.get().seconds;
    timeFormat = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(showSeconds && { second: "2-digit" }),
      ...Settings.timeOptions(),
    });
  }

  const dateFormat = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function greetingFor(hour) {
    if (hour >= 5 && hour < 12) return "Good morning, Victor";
    if (hour >= 12 && hour < 17) return "Good afternoon, Victor";
    return "Good evening, Victor";
  }

  function renderTime(now) {
    // Split out seconds and AM/PM (if the locale uses it) so they can be styled smaller.
    const parts = timeFormat.formatToParts(now);
    let main = "";
    let seconds = "";
    let period = "";
    parts.forEach((part, i) => {
      if (part.type === "second") seconds = part.value;
      else if (part.type === "dayPeriod") period = part.value;
      // Drop separators that only precede the seconds or AM/PM.
      else if (part.type === "literal" && ["second", "dayPeriod"].includes(parts[i + 1]?.type)) return;
      else main += part.value;
    });

    timeEl.textContent = main.trim();
    if (!seconds && !period) return;
    // Stacked beside the hours and minutes: AM/PM on top, seconds below.
    const span = (className, text) => Object.assign(document.createElement("span"), { className, textContent: text });
    const aside = span("clock__aside", "");
    if (period) aside.append(span("clock__period", period));
    if (seconds) aside.append(span("clock__seconds", seconds));
    timeEl.append(aside);
  }

  function render() {
    const now = new Date();
    renderTime(now);
    dateEl.textContent = dateFormat.format(now);
    greetingEl.textContent = greetingFor(now.getHours());
  }

  // Re-render at the start of each second or minute (depending on the setting).
  function scheduleNextTick() {
    clearTimeout(timer);
    const now = new Date();
    const ms = showSeconds
      ? 1000 - now.getMilliseconds()
      : (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    timer = setTimeout(() => {
      render();
      scheduleNextTick();
    }, ms + 20);
  }

  function start() {
    configure();
    render();
    scheduleNextTick();
  }

  start();
  Settings.onChange(start);

  // Don't tick in background tabs; catch up when the tab is shown again.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else start();
  });
})();
