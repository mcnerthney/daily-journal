export const API = "/api";

export const getTodayKey = () =>
    new Date().toLocaleDateString("en-CA");

export const formatDate = (d) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });

export async function fetchAllEntries(headers = {}) {
    const res = await fetch(`${API}/entries`, { headers });
    if (!res.ok) {
        const err = new Error("fetch failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}
export async function saveEntry(date, data, headers = {}) {
    const res = await fetch(`${API}/entries/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const err = new Error("save failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
}
