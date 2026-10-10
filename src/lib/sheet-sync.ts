import { syncEventSheet } from "./sheets.functions";

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced background sync so check-ins update the Google Sheet without hitting rate limits. */
export function scheduleSheetSync(eventId: string, delay = 20000) {
  clearTimeout(timers.get(eventId));
  timers.set(eventId, setTimeout(() => {
    timers.delete(eventId);
    syncEventSheet({ data: { eventId } }).catch((e) => console.warn("sheet sync", e));
  }, delay));
}
