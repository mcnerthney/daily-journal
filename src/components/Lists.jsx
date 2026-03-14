import React, { useState, useEffect, useRef } from "react";
import { fetchLists, createList, updateList, deleteList } from "../utils";

export default function Lists({ token, socket, selectedId: routeSelectedId, onSelectList, onCloseList }) {
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

    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
    const inputStyle = {
        background: "#161622",
        color: "#e8e8f0",
        border: "1px solid #34344a",
        borderRadius: "6px",
    };

    // load lists
    useEffect(() => {
        if (!token) return;
        fetchLists(authHeaders)
            .then(setLists)
            .catch((e) => {
                console.error(e);
                if (e.code === 401) return; // handled by parent
            });
    }, [token]);

    // keep selection synced with hash route when App drives this screen
    useEffect(() => {
        if (routeSelectedId === undefined) return;
        setSelectedId(routeSelectedId || null);
        setNewItem("");
        setShareInput("");
        setError("");
    }, [routeSelectedId]);

    // subscribe to realtime updates
    useEffect(() => {
        if (!socket) return;
        const handler = (updated) => {
            setLists((prev) => {
                const idx = prev.findIndex((l) => l._id === updated._id);
                if (idx > -1) {
                    const copy = [...prev];
                    copy[idx] = updated;
                    return copy;
                }
                return [...prev, updated];
            });
        };
        const delHandler = ({ id }) => {
            setLists((prev) => prev.filter((l) => l._id !== id));
            if (selectedId === id) {
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
        if (onSelectList) {
            onSelectList(id);
        } else {
            setSelectedId(id);
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
        setLists((prev) => prev.map((list) => (list._id === updated._id ? updated : list)));
    };

    const saveItems = async (items, errorMessage) => {
        if (!selectedId) return;
        try {
            const updated = await updateList(selectedId, { items }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(errorMessage);
        }
    };

    const saveNewList = async () => {
        if (!newName.trim()) return;
        try {
            const doc = await createList({ name: newName.trim(), public: newNamePublic }, authHeaders);
            setLists((p) => [...p, doc]);
            setNewName("");
            setNewNamePublic(false);
            selectList(doc._id);
        } catch (e) {
            console.error(e);
            setError("Unable to create list");
        }
    };

    const addItem = async () => {
        if (!newItem.trim() || !selectedId) return;
        const list = lists.find((l) => l._id === selectedId);
        const items = [...(list.items || []), { text: newItem.trim(), done: false }];
        try {
            const updated = await updateList(selectedId, { items }, authHeaders);
            applyListUpdate(updated);
            setNewItem("");
            setError("");
        } catch (e) {
            console.error(e);
            setError("Unable to add item");
        }
    };

    const toggleItem = async (index) => {
        const list = lists.find((l) => l._id === selectedId);
        const items = list.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
        await saveItems(items, "Unable to toggle item");
    };

    const renameItem = async (index, value) => {
        const list = lists.find((l) => l._id === selectedId);
        if (!list) return;
        const text = value.trim();
        if (!text || text === list.items?.[index]?.text) return;
        const items = list.items.map((it, i) => (i === index ? { ...it, text } : it));
        await saveItems(items, "Unable to rename item");
    };

    const deleteItem = async (index) => {
        const list = lists.find((l) => l._id === selectedId);
        const items = (list?.items || []).filter((_, itemIndex) => itemIndex !== index);
        await saveItems(items, "Unable to delete item");
    };

    const changeName = async (name) => {
        const list = lists.find((l) => l._id === selectedId);
        if (!list) return;
        try {
            const updated = await updateList(selectedId, { name }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError("Unable to rename");
        }
    };

    const saveShares = async () => {
        const emails = shareInput.split(",").map(s => s.trim()).filter(Boolean);
        try {
            const updated = await updateList(selectedId, { shareWithEmails: emails }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError("Unable to update sharing");
        }
    };

    const deleteCurrent = async () => {
        if (!selectedId) return;
        try {
            await deleteList(selectedId, authHeaders);
            setLists((p) => p.filter((l) => l._id !== selectedId));
            if (onCloseList) {
                onCloseList();
            } else {
                setSelectedId(null);
            }
        } catch (e) {
            console.error(e);
            setError("Unable to delete");
        }
    };

    const selected = lists.find((l) => l._id === selectedId) || {};
    const publicLastViewedAtLabel = selected.publicLastViewedAt
        ? new Date(selected.publicLastViewedAt).toLocaleString()
        : "Never";

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
                    style={{ justifySelf: "start", background: "none", border: "none", color: "#4ade80", cursor: "pointer", fontSize: "14px", padding: 0 }}
                >
                    ← Back to lists
                </button>
                <div style={{ color: "#888" }}>Loading list...</div>
                {error && <div style={{ color: "#ef4444" }}>{error}</div>}
            </div>
        );
    }

    if (selectedId) {
        return (
            <div style={{ minHeight: "calc(100vh - 180px)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "12px", flexWrap: "wrap" }}>
                    <button
                        onClick={backToLists}
                        style={{ background: "none", border: "none", color: "#4ade80", cursor: "pointer", fontSize: "14px", padding: 0 }}
                    >
                        ← Back to lists
                    </button>
                    {isOwner && (
                        <button onClick={deleteCurrent} style={{ color: "#ef4444" }}>Delete list</button>
                    )}
                </div>

                <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
                    <input
                        value={selected.name || ""}
                        onChange={e => changeName(e.target.value)}
                        disabled={!isOwner}
                        style={{
                            ...inputStyle,
                            fontSize: "22px",
                            padding: "10px 12px",
                            opacity: isOwner ? 1 : 0.7,
                            background: isOwner ? inputStyle.background : "#1a1a23",
                        }}
                    />
                    {selected.ownerEmail && (
                        <div style={{ fontSize: "12px", color: "#888" }}>
                            Owner: {selected.ownerEmail}
                        </div>
                    )}
                </div>

                <h4>Items</h4>
                <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="New item" style={{ ...inputStyle, flex: 1, minWidth: "220px", padding: "6px" }} />
                    <button onClick={addItem}>Add</button>
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
                                const list = lists.find((l) => l._id === selectedId);
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
                                gap: "8px",
                                marginBottom: "8px",
                                borderTop: dragOverIndex === idx ? "2px solid #6d5acd" : "2px solid transparent",
                            }}
                        >
                            <span
                                style={{ cursor: "grab", color: "#555", userSelect: "none", fontSize: "18px", lineHeight: 1 }}
                                title="Drag to reorder"
                            >
                                ⠿
                            </span>
                            <input type="checkbox" checked={it.done} onChange={() => toggleItem(idx)} />
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
                                    color: it.done ? "#888" : "#e8e8f0",
                                    //textDecoration: it.done ? "line-through" : "none",
                                }}
                            />
                        </li>
                    ))}
                </ul>
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
                        border: `2px dashed ${trashOver ? "#ef4444" : "#555"}`,
                        background: trashOver ? "#ef444422" : "transparent",
                        fontSize: "18px",
                        marginBottom: "8px",
                        transition: "all 0.15s",
                        cursor: "default",
                    }}
                >
                    🗑️
                </div>
                {isOwner && (
                    <div>
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
                                        setError("Unable to update public flag");
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
                                        Slug URL: <a href={`/lists/public/${encodeURIComponent(selected.publicSlug)}`} target="_blank" rel="noopener noreferrer">/lists/public/{selected.publicSlug}</a>
                                    </div>
                                )}
                                {selected.publicId && (
                                    <div>
                                        UUID URL: <a href={`/lists/public/${selected.publicId}`} target="_blank" rel="noopener noreferrer">/lists/public/{selected.publicId}</a>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {error && <div style={{ color: "#ef4444", marginTop: "12px" }}>{error}</div>}
            </div>
        );
    }

    return (
        <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", color: "#c9b8ff" }}>Lists</h2>
            <h3>Your lists</h3>
            <ul style={{ padding: 0, listStyle: "none", display: "grid", gap: "8px" }}>
                {lists.map(l => (
                    <li key={l._id}>
                        <button
                            onClick={() => selectList(l._id)}
                            style={{
                                width: "100%",
                                textAlign: "left",
                                background: "#12121a",
                                border: "1px solid #2a2a3a",
                                borderRadius: "10px",
                                color: "#c9b8ff",
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
            <div style={{ marginTop: "20px", maxWidth: "420px" }}>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New list name" style={{ ...inputStyle, width: "100%", padding: "8px" }} />
                <div style={{ marginTop: "8px", fontSize: "14px" }}>
                    <label>
                        <input
                            type="checkbox"
                            checked={newNamePublic || false}
                            onChange={e => setNewNamePublic(e.target.checked)}
                        />{' '}
                        Public
                    </label>
                </div>
                <button onClick={saveNewList} style={{ marginTop: "8px" }}>Create</button>
            </div>
            {error && <div style={{ color: "#ef4444", marginTop: "12px" }}>{error}</div>}
        </div>
    );
}
