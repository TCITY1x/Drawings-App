/**
 * This browser's id, written on every row it saves so a device can tell its
 * own writes from someone else's when realtime sync is added.
 */
function makeId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem("fieldmark:client-id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem("fieldmark:client-id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const CLIENT_ID = makeId();
