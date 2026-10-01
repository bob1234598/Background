// Clock, date and time-of-day greeting.
(() => {
  const timeEl = document.getElementById("time");
  const dateEl = document.getElementById("date");
  const greetingEl = document.getElementById("greeting");

  const timeFormat = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const dateFormat = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function greetingFor(hour) {
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    return "Good evening";
  }

  function renderTime(now) {
    // Split out AM/PM (if the locale uses it) so it can be styled smaller.
    let main = "";
    let period = "";
    for (const part of timeFormat.formatToParts(now)) {
      if (part.type === "dayPeriod") period = part.value;
      else main += part.value;
    }

    timeEl.textContent = main.trim();
    if (period) {
      const span = document.createElement("span");
      span.className = "clock__period";
      span.textContent = period;
      timeEl.append(span);
    }
  }

  function render() {
    const now = new Date();
    renderTime(now);
    dateEl.textContent = dateFormat.format(now);
    greetingEl.textContent = greetingFor(now.getHours());
  }

  // Re-render at the start of each minute, then every minute after.
  function scheduleNextTick() {
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
      render();
      scheduleNextTick();
    }, msToNextMinute + 20);
  }

  render();
  scheduleNextTick();

  // Timers are throttled in background tabs; refresh when the tab is shown again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
})();
