export const API = "/api";

/** Decode the userId from a JWT without verifying the signature (client-side only). */
export function getUserIdFromToken(token) {
    try {
        return JSON.parse(atob(token.split(".")[1])).userId || null;
    } catch {
        return null;
    }
}

export const getTodayKey = () =>
    new Date().toLocaleDateString("en-CA");

export const formatDate = (d) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });

export const getRelativeDateLabel = (dateKey, todayKey = getTodayKey()) => {
    if (dateKey === todayKey) return "Today";

    const todayDate = new Date(todayKey + "T12:00:00");
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);
    const yesterdayKey = yesterdayDate.toLocaleDateString("en-CA");

    if (dateKey === yesterdayKey) return "Yesterday";
    return formatDate(dateKey);
};

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

// ----- lists helpers ------------------------------------------------------
export async function fetchLists(headers = {}, options = {}) {
    const params = new URLSearchParams();
    if (options.includeArchived) params.set("includeArchived", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${API}/lists${query}`, { headers });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "fetch failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json(); // array of list docs
}

export async function createList(data, headers = {}) {
    const res = await fetch(`${API}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "create failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function updateList(id, data, headers = {}) {
    const res = await fetch(`${API}/lists/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "update failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function createListItem(listId, data, headers = {}) {
    const res = await fetch(`${API}/lists/${listId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "create item failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function fetchListItem(listId, itemId, headers = {}) {
    const res = await fetch(`${API}/lists/${listId}/items/${itemId}`, {
        method: "GET",
        headers,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "fetch item failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function updateListItem(listId, itemId, data, headers = {}) {
    const res = await fetch(`${API}/lists/${listId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        if (res.status === 413) {
            const err = new Error("Image is too large. Please choose a smaller file.");
            throw err;
        }
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "update item failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function deleteListItem(listId, itemId, headers = {}) {
    const res = await fetch(`${API}/lists/${listId}/items/${itemId}`, {
        method: "DELETE",
        headers,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "delete item failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function reorderListItems(listId, itemIds, headers = {}) {
    const res = await fetch(`${API}/lists/${listId}/items/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ itemIds }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "reorder items failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function transferListItem(listId, itemId, data, headers = {}) {
    const res = await fetch(`${API}/lists/${listId}/items/${itemId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "transfer item failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function deleteList(id, headers = {}, options = {}) {
    const params = new URLSearchParams();
    if (options.permanent) params.set("permanent", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${API}/lists/${id}${query}`, {
        method: "DELETE",
        headers,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || "delete failed");
        if (res.status === 401) err.code = 401;
        throw err;
    }
    return res.json();
}

export async function fetchPublicList(publicKey) {
    const res = await fetch(`${API}/public/${encodeURIComponent(publicKey)}`);
    if (!res.ok) {
        const err = new Error("fetch failed");
        if (res.status === 404) err.code = 404;
        throw err;
    }
    return res.json();
}
