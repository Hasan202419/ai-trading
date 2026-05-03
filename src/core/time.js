const FORMATTER_CACHE = new Map();

function formatterFor(timeZone) {
  if (!FORMATTER_CACHE.has(timeZone)) {
    FORMATTER_CACHE.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        weekday: "short"
      })
    );
  }
  return FORMATTER_CACHE.get(timeZone);
}

export function getZonedParts(timestamp, timeZone) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function isWeekday(zonedParts) {
  return zonedParts.weekday !== "Sat" && zonedParts.weekday !== "Sun";
}

export function isInSession(timestamp, settings) {
  const parts = getZonedParts(timestamp, settings.marketTimezone);
  const start =
    settings.openHour * 60 + settings.openMinute + settings.startDelayMinutes;
  const end =
    settings.closeHour * 60 + settings.closeMinute - settings.endBeforeCloseMinutes;
  return isWeekday(parts) && parts.minuteOfDay >= start && parts.minuteOfDay < end;
}

export function isSessionExit(timestamp, settings) {
  const parts = getZonedParts(timestamp, settings.marketTimezone);
  const end =
    settings.closeHour * 60 + settings.closeMinute - settings.endBeforeCloseMinutes;
  return isWeekday(parts) && parts.minuteOfDay >= end;
}
