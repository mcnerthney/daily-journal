import React, { useState, useEffect, useRef } from "react";
import { fetchLists, createList, updateList, deleteList } from "../utils";

export default function Lists({ token, socket, selectedId: routeSelectedId, onSelectList, onCloseList, onSelectedListTitle }) {
    const [lists, setLists] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [newName, setNewName] = useState("");
    const [newNamePublic, setNewNamePublic] = useState(false);
    const [newItem, setNewItem] = useState("");
    const [shareInput, setShareInput] = useState("");
    const [error, setError] = useState("");
    const dragIndex = useRef(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [trashOver, setTrashOver] = useState(false);
    const dragListId = useRef(null);
    const [dragOverListId, setDragOverListId] = useState(null);
    const [showArchived, setShowArchived] = useState(false);

    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    const inputStyle = {
        background: "var(--input-bg)",
        color: "var(--input-text)",
        border: "1px solid var(--input-border)",
        borderRadius: "6px",
    };
    const createButtonStyle = {
        width: "fit-content",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        color: "var(--heading)",
        cursor: "pointer",
        padding: "10px 12px",
        fontSize: "14px",
        whiteSpace: "nowrap",
    };

    const getListId = (list) => {
        if (!list) return "";
        return String(list._id ?? list.id ?? "");
    };

    const sortLists = (items) => {
        const toOrder = (list) => {
            const value = Number(list?.sortOrder);
            return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
        };
        return [...items].sort((a, b) => {
            const byOrder = toOrder(a) - toOrder(b);
            if (byOrder !== 0) return byOrder;
            return (a.name || "").localeCompare(b.name || "");
        });
    };

    const upsertList = (incoming) => {
        setLists((prev) => {
            const incomingId = getListId(incoming);
            if (!incomingId) return [...prev, incoming];
            const idx = prev.findIndex((l) => getListId(l) === incomingId);
            if (idx === -1) return [...prev, incoming];
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...incoming };
            return copy;
        });
    };

    const formatActionError = (fallback, err) => {
        const detail = err?.message && err.message !== fallback ? err.message : "";
        return detail ? `${fallback}: ${detail}` : fallback;
    };

    // load lists
    useEffect(() => {
        if (!token) return;
        fetchLists(authHeaders, { includeArchived: true })
            .then(setLists)
            .catch((e) => {
                console.error(e);
                if (e.code === 401) return; // handled by parent
            });
    }, [token]);

    // keep selection synced with hash route when App drives this screen
    useEffect(() => {
        if (routeSelectedId === undefined) return;
        setSelectedId(routeSelectedId ? String(routeSelectedId) : null);
        setNewItem("");
        setShareInput("");
        setError("");
    }, [routeSelectedId]);

    // subscribe to realtime updates
    useEffect(() => {
        if (!socket) return;
        const handler = (updated) => {
            upsertList(updated);
        };
        const delHandler = ({ id }) => {
            const deletedId = String(id || "");
            setLists((prev) => prev.filter((l) => getListId(l) !== deletedId));
            if (String(selectedId || "") === deletedId) {
                setSelectedId(null);
                if (onCloseList) onCloseList();
            }
        };
        socket.on("list:updated", handler);
        socket.on("list:deleted", delHandler);
        return () => {
            socket.off("list:updated", handler);
            socket.off("list:deleted", delHandler);
        };
    }, [socket, selectedId, onCloseList]);

    const selectList = (id) => {
        const normalizedId = String(id || "");
        if (!normalizedId) return;
        if (onSelectList) {
            onSelectList(normalizedId);
        } else {
            setSelectedId(normalizedId);
        }
        setNewItem("");
        setShareInput("");
    };

    const backToLists = () => {
        if (onCloseList) {
            onCloseList();
        } else {
            setSelectedId(null);
        }
        setNewItem("");
        setShareInput("");
        setError("");
    };

    const applyListUpdate = (updated) => {
        upsertList(updated);
    };

    const saveItems = async (items, errorMessage) => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId) return;
        try {
            const updated = await updateList(selectedListId, { items }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError(errorMessage, e));
        }
    };

    const saveNewList = async () => {
        if (!newName.trim()) return;
        try {
            const doc = await createList({ name: newName.trim(), public: newNamePublic }, authHeaders);
            upsertList(doc);
            setNewName("");
            setNewNamePublic(false);
            selectList(getListId(doc));
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to create list", e));
        }
    };

    const addItem = async () => {
        const selectedListId = String(selectedId || "");
        if (!newItem.trim() || !selectedListId) return;
        const list = lists.find((l) => getListId(l) === selectedListId);
        const items = [{ text: newItem.trim(), done: false }, ...(list?.items || [])];
        try {
            const updated = await updateList(selectedListId, { items }, authHeaders);
            applyListUpdate(updated);
            setNewItem("");
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to add item", e));
        }
    };

    const toggleItem = async (index) => {
        const selectedListId = String(selectedId || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        if (!list) return;
        const items = list.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
        await saveItems(items, "Unable to toggle item");
    };

    const renameItem = async (index, value) => {
        const selectedListId = String(selectedId || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        if (!list) return;
        const text = value.trim();
        if (!text || text === list.items?.[index]?.text) return;
        const items = list.items.map((it, i) => (i === index ? { ...it, text } : it));
        await saveItems(items, "Unable to rename item");
    };

    const deleteItem = async (index) => {
        const selectedListId = String(selectedId || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        const items = (list?.items || []).filter((_, itemIndex) => itemIndex !== index);
        await saveItems(items, "Unable to delete item");
    };

    const changeName = async (name) => {
        const selectedListId = String(selectedId || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        if (!list) return;
        try {
            const updated = await updateList(selectedListId, { name }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to rename", e));
        }
    };

    const saveShares = async () => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId) return;
        const emails = shareInput.split(",").map(s => s.trim()).filter(Boolean);
        try {
            const updated = await updateList(selectedListId, { shareWithEmails: emails }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to update sharing", e));
        }
    };

    const archiveCurrent = async () => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId) return;
        try {
            const updated = await updateList(selectedListId, { archived: true }, authHeaders);
            applyListUpdate(updated);
            if (onCloseList) {
                onCloseList();
            } else {
                setSelectedId(null);
            }
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to archive", e));
        }
    };

    const unarchiveCurrent = async () => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId) return;
        try {
            const updated = await updateList(selectedListId, { archived: false }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to unarchive", e));
        }
    };

    const permanentDeleteCurrent = async () => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId) return;
        try {
            await deleteList(selectedListId, authHeaders, { permanent: true });
            setLists((prev) => prev.filter((l) => getListId(l) !== selectedListId));
            if (onCloseList) {
                onCloseList();
            } else {
                setSelectedId(null);
            }
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to permanently delete", e));
        }
    };

    const reorderLists = async (targetId, archivedState) => {
        const sourceId = String(dragListId.current || "");
        const normalizedTargetId = String(targetId || "");
        dragListId.current = null;
        setDragOverListId(null);

        if (!sourceId || !normalizedTargetId || sourceId === normalizedTargetId) return;

        const group = sortLists(lists.filter((l) => !!l.archived === archivedState));
        const from = group.findIndex((l) => getListId(l) === sourceId);
        const to = group.findIndex((l) => getListId(l) === normalizedTargetId);
        if (from === -1 || to === -1) return;

        const reordered = [...group];
        const [moved] = reordered.splice(from, 1);
        reordered.splice(to, 0, moved);
        const nextOrderMap = new Map(reordered.map((list, idx) => [getListId(list), idx]));

        setLists((prev) => prev.map((list) => {
            if (!!list.archived !== archivedState) return list;
            const nextOrder = nextOrderMap.get(getListId(list));
            if (nextOrder === undefined) return list;
            return { ...list, sortOrder: nextOrder };
        }));

        try {
            await Promise.all(
                reordered.map((list, idx) => updateList(getListId(list), { sortOrder: idx }, authHeaders))
            );
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to reorder lists", e));
            fetchLists(authHeaders, { includeArchived: true })
                .then(setLists)
                .catch(() => { });
        }
    };

    const selected = lists.find((l) => getListId(l) === String(selectedId || "")) || {};
    const activeLists = sortLists(lists.filter((l) => !l.archived));
    const archivedLists = sortLists(lists.filter((l) => l.archived));
    const publicLastViewedAtLabel = selected.publicLastViewedAt
        ? new Date(selected.publicLastViewedAt).toLocaleString()
        : "Never";

    useEffect(() => {
        if (!onSelectedListTitle) return;
        if (!selectedId) {
            onSelectedListTitle("");
            return;
        }
        onSelectedListTitle(selected.title || selected.name || "");
    }, [onSelectedListTitle, selectedId, selected.title, selected.name]);

    // decode simple JWT to access userId for owner checks
    const decodeToken = (t) => {
        try {
            const payload = t.split(".")[1];
            return JSON.parse(atob(payload));
        } catch (_) {
            return {};
        }
    };
    const me = decodeToken(token).userId;
    const isOwner = selected.owner === me;

    if (selectedId && !selected._id) {
        return (
            <div style={{ minHeight: "calc(100vh - 180px)", display: "grid", gap: "12px" }}>
                <button
                    onClick={backToLists}
                    style={{ justifySelf: "start", background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", fontSize: "14px", padding: 0 }}
                >
                    ← Back to lists
                </button>
                <div style={{ color: "var(--muted)" }}>Loading list...</div>
                {error && <div style={{ color: "var(--error)" }}>{error}</div>}
            </div>
        );
    }

    if (selectedId) {
        return (
            <div style={{ minHeight: "calc(100vh + 220px)", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
                    <input
                        value={selected.name || ""}
                        onChange={e => changeName(e.target.value)}
                        disabled={!isOwner || !!selected.archived}
                        style={{
                            ...inputStyle,
                            fontSize: "22px",
                            padding: "10px 12px",
                            opacity: isOwner ? 1 : 0.7,
                            background: isOwner ? inputStyle.background : "var(--surface-soft)",
                        }}
                    />
                    {selected.ownerEmail && (
                        <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                            Owner: {selected.ownerEmail}
                        </div>
                    )}
                </div>

                <h4>Items</h4>
                <div style={{ marginTop: "8px", marginBottom: "8px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                        value={newItem}
                        onChange={e => setNewItem(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                addItem();
                            }
                        }}
                        onBlur={addItem}
                        placeholder="New item"
                        disabled={!!selected.archived}
                        style={{ ...inputStyle, flex: 1, minWidth: "220px", padding: "6px" }}
                    />
                    <div
                        onDragOver={(e) => { e.preventDefault(); setTrashOver(true); }}
                        onDragLeave={() => setTrashOver(false)}
                        onDrop={async () => {
                            setTrashOver(false);
                            if (dragIndex.current !== null) {
                                const idx = dragIndex.current;
                                dragIndex.current = null;
                                await deleteItem(idx);
                            }
                        }}
                        title="Drop here to delete"
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "36px",
                            height: "36px",
                            borderRadius: "6px",
                            border: `2px solid ${trashOver ? "var(--error)" : "transparent"}`,
                            background: trashOver ? "var(--error-soft)" : "transparent",
                            fontSize: "18px",
                            flexShrink: 0,
                            transition: "all 0.15s",
                            cursor: "default",
                        }}
                    >
                        🗑️
                    </div>
                </div>
                <ul style={{ padding: 0, listStyle: "none" }}>
                    {(selected.items || []).map((it, idx) => (
                        <li
                            key={`${selectedId}-${idx}-${it.text}`}
                            draggable
                            onDragStart={() => { dragIndex.current = idx; }}
                            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
                            onDrop={async () => {
                                if (dragIndex.current === null || dragIndex.current === idx) {
                                    setDragOverIndex(null);
                                    dragIndex.current = null;
                                    return;
                                }
                                const list = lists.find((l) => getListId(l) === String(selectedId || ""));
                                const items = [...(list?.items || [])];
                                const [moved] = items.splice(dragIndex.current, 1);
                                items.splice(idx, 0, moved);
                                setDragOverIndex(null);
                                dragIndex.current = null;
                                await saveItems(items, "Unable to reorder items");
                            }}
                            onDragEnd={() => { setDragOverIndex(null); setTrashOver(false); dragIndex.current = null; }}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                marginBottom: "8px",
                                borderTop: dragOverIndex === idx ? "2px solid var(--ring)" : "2px solid transparent",
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={it.done}
                                onChange={() => toggleItem(idx)}
                                style={{
                                    width: "16px",
                                    height: "16px",
                                    accentColor: it.done ? "var(--muted)" : "var(--text)",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                }}
                            />
                            <input
                                defaultValue={it.text}
                                onBlur={(e) => renameItem(idx, e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") e.currentTarget.blur();
                                }}
                                style={{
                                    ...inputStyle,
                                    flex: 1,
                                    padding: "6px",
                                    color: it.done ? "var(--muted)" : "var(--text)",
                                    //textDecoration: it.done ? "line-through" : "none",
                                }}
                                disabled={!!selected.archived}
                            />
                        </li>
                    ))}
                </ul>

                {isOwner && (
                    <div style={{ marginTop: "10px" }}>
                        <label style={{ fontSize: "14px" }}>
                            <input
                                type="checkbox"
                                checked={!!selected.public}
                                onChange={async () => {
                                    try {
                                        const updated = await updateList(selectedId, { public: !selected.public }, authHeaders);
                                        applyListUpdate(updated);
                                        setError("");
                                    } catch (e) {
                                        console.error(e);
                                        setError(formatActionError("Unable to update public flag", e));
                                    }
                                }}
                            />{' '}
                            Make public (guest view)
                        </label>
                        {selected.public && (selected.publicSlug || selected.publicId) && (
                            <div style={{ marginTop: "4px", fontSize: "12px", display: "grid", gap: "2px" }}>
                                <div>
                                    Public views: {selected.publicViewCount || 0}
                                </div>
                                <div>
                                    Last viewed: {publicLastViewedAtLabel}
                                </div>
                                {selected.publicSlug && (
                                    <div>
                                        Slug URL: <a href={`/lists/public/${encodeURIComponent(selected.publicSlug)}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)", textDecoration: "none" }}>/lists/public/{selected.publicSlug}</a>
                                    </div>
                                )}
                                {selected.publicId && (
                                    <div>
                                        UUID URL: <a href={`/lists/public/${selected.publicId}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)", textDecoration: "none" }}>/lists/public/{selected.publicId}</a>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {isOwner && (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "auto", paddingTop: "24px" }}>
                        {!selected.archived && (
                            <button onClick={archiveCurrent} style={{ width: "fit-content", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--error)", cursor: "pointer", padding: "10px 12px", fontSize: "14px" }}>Archive list</button>
                        )}
                        {selected.archived && (
                            <>
                                <button onClick={unarchiveCurrent} style={{ width: "fit-content", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--heading)", cursor: "pointer", padding: "10px 12px", fontSize: "14px" }}>Unarchive list</button>
                                <button onClick={permanentDeleteCurrent} style={{ width: "fit-content", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", color: "var(--error)", cursor: "pointer", padding: "10px 12px", fontSize: "14px" }}>Permanently delete</button>
                            </>
                        )}
                    </div>
                )}
                {error && <div style={{ color: "var(--error)", marginTop: "12px" }}>{error}</div>}
            </div>
        );
    }

    return (
        <div>
            <div style={{ marginTop: "20px", marginBottom: "16px", width: "100%", display: "flex", gap: "8px", alignItems: "stretch" }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New list name" style={{ ...inputStyle, flex: 1, padding: "8px" }} />
                <button onClick={saveNewList} style={createButtonStyle}>Create</button>
            </div>
            <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: "8px" }}>
                {activeLists.map(l => (
                    <li
                        key={getListId(l)}
                        draggable
                        onDragStart={() => { dragListId.current = getListId(l); }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverListId(getListId(l));
                        }}
                        onDrop={async () => {
                            await reorderLists(getListId(l), false);
                        }}
                        onDragEnd={() => {
                            dragListId.current = null;
                            setDragOverListId(null);
                        }}
                        style={{
                            borderTop: dragOverListId === getListId(l) ? "2px solid var(--ring)" : "2px solid transparent",
                            borderRadius: "10px",
                            paddingTop: dragOverListId === getListId(l) ? "4px" : 0,
                            transition: "border-color 0.15s ease",
                        }}
                    >
                        <button
                            onClick={() => selectList(getListId(l))}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                background: "var(--surface)",
                                border: "1px solid var(--border)",
                                borderRadius: "10px",
                                color: "var(--heading)",
                                cursor: "pointer",
                                padding: "12px",
                                fontSize: "14px",
                            }}
                        >
                            {l.name}
                        </button>
                    </li>
                ))}
            </ul>
            {archivedLists.length > 0 && (
                <div style={{ marginTop: "14px" }}>
                    <button
                        onClick={() => setShowArchived((v) => !v)}
                        style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, fontSize: "13px" }}
                    >
                        {showArchived ? "Hide archived" : `Show archived (${archivedLists.length})`}
                    </button>
                    {showArchived && (
                        <ul style={{ marginTop: "8px", padding: 0, listStyle: "none", display: "grid", gap: "8px" }}>
                            {archivedLists.map(l => (
                                <li
                                    key={getListId(l)}
                                    draggable
                                    onDragStart={() => { dragListId.current = getListId(l); }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setDragOverListId(getListId(l));
                                    }}
                                    onDrop={async () => {
                                        await reorderLists(getListId(l), true);
                                    }}
                                    onDragEnd={() => {
                                        dragListId.current = null;
                                        setDragOverListId(null);
                                    }}
                                    style={{
                                        borderTop: dragOverListId === getListId(l) ? "2px solid var(--ring)" : "2px solid transparent",
                                        borderRadius: "10px",
                                        paddingTop: dragOverListId === getListId(l) ? "4px" : 0,
                                        transition: "border-color 0.15s ease",
                                    }}
                                >
                                    <button
                                        onClick={() => selectList(getListId(l))}
                                        style={{
                                            width: "100%",
                                            textAlign: "left",
                                            background: "var(--surface-soft)",
                                            border: "1px dashed var(--border)",
                                            borderRadius: "10px",
                                            color: "var(--muted)",
                                            cursor: "pointer",
                                            padding: "12px",
                                            fontSize: "14px",
                                        }}
                                    >
                                        {l.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {error && <div style={{ color: "var(--error)", marginTop: "12px" }}>{error}</div>}
        </div>
    );
}
