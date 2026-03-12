import React, { useState, useEffect } from "react";
import { fetchLists, createList, updateList, deleteList } from "../utils";

export default function Lists({ token, socket }) {
    const [lists, setLists] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [newName, setNewName] = useState("");
    const [newNamePublic, setNewNamePublic] = useState(false);
    const [newItem, setNewItem] = useState("");
    const [shareInput, setShareInput] = useState("");
    const [error, setError] = useState("");

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
            if (selectedId === id) setSelectedId(null);
        };
        socket.on("list:updated", handler);
        socket.on("list:deleted", delHandler);
        return () => {
            socket.off("list:updated", handler);
            socket.off("list:deleted", delHandler);
        };
    }, [socket, selectedId]);

    const selectList = (id) => {
        setSelectedId(id);
        setNewItem("");
        setShareInput("");
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

    const moveItem = async (index, direction) => {
        const list = lists.find((l) => l._id === selectedId);
        const items = [...(list?.items || [])];
        const nextIndex = index + direction;
        if (!items[index] || nextIndex < 0 || nextIndex >= items.length) return;
        [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
        await saveItems(items, "Unable to reorder items");
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
            setSelectedId(null);
        } catch (e) {
            console.error(e);
            setError("Unable to delete");
        }
    };

    const selected = lists.find((l) => l._id === selectedId) || {};

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

    return (
        <div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", color: "#c9b8ff" }}>Lists</h2>
            <div style={{ display: "flex", gap: "24px" }}>
                <div style={{ flex: 1, maxWidth: "220px" }}>
                    <h3>Your lists</h3>
                    <ul style={{ padding: 0, listStyle: "none" }}>
                        {lists.map(l => (
                            <li key={l._id} style={{ marginBottom: "6px" }}>
                                <button onClick={() => selectList(l._id)} style={{ background: selectedId === l._id ? "#6d5acd22" : "transparent", border: "none", color: "#c9b8ff", cursor: "pointer" }}>
                                    {l.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div style={{ marginTop: "16px" }}>
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New list name" style={{ ...inputStyle, width: "100%", padding: "6px" }} />
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
                        <button onClick={saveNewList} style={{ marginTop: "8px", width: "100%" }}>Create</button>
                    </div>
                </div>
                <div style={{ flex: 3 }}>
                    {selectedId && (
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                                <input
                                    value={selected.name}
                                    onChange={e => changeName(e.target.value)}
                                    disabled={!isOwner}
                                    style={{
                                        ...inputStyle,
                                        fontSize: "18px",
                                        padding: "6px 8px",
                                        opacity: isOwner ? 1 : 0.7,
                                        background: isOwner ? inputStyle.background : "#1a1a23",
                                    }}
                                />
                                {isOwner && (
                                    <button onClick={deleteCurrent} style={{ color: "#ef4444" }}>Delete</button>
                                )}
                            </div>
                            {selected.ownerEmail && (
                                <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>
                                    Owner: {selected.ownerEmail}
                                </div>
                            )}
                            {isOwner && (
                                <div style={{ marginTop: "8px" }}>
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
                                    {selected.public && selected.publicId && (
                                        <div style={{ marginTop: "4px", fontSize: "12px" }}>
                                            URL: <a href={`/lists/public/${selected.publicId}`} target="_blank" rel="noopener noreferrer">/lists/public/{selected.publicId}</a>
                                        </div>
                                    )}
                                </div>
                            )}
                            <h4>Items</h4>
                            <ul style={{ padding: 0, listStyle: "none" }}>
                                {(selected.items || []).map((it, idx) => (
                                    <li key={`${selectedId}-${idx}-${it.text}`} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
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
                                                textDecoration: it.done ? "line-through" : "none",
                                            }}
                                        />
                                        <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} aria-label={`Move ${it.text} up`}>
                                            ↑
                                        </button>
                                        <button
                                            onClick={() => moveItem(idx, 1)}
                                            disabled={idx === (selected.items || []).length - 1}
                                            aria-label={`Move ${it.text} down`}
                                        >
                                            ↓
                                        </button>
                                        <button onClick={() => deleteItem(idx)} aria-label={`Delete ${it.text}`} style={{ color: "#ef4444" }}>
                                            Delete
                                        </button>
                                    </li>
                                ))}
                            </ul>
                            <div style={{ marginTop: "8px" }}>
                                <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="New item" style={{ ...inputStyle, width: "70%", padding: "6px" }} />
                                <button onClick={addItem} style={{ marginLeft: "8px" }}>Add</button>
                            </div>
                            {isOwner && (
                                <>
                                    <h4>Share with</h4>
                                    <div>
                                        <input value={shareInput} onChange={e => setShareInput(e.target.value)} placeholder="comma-separated emails" style={{ ...inputStyle, width: "100%", padding: "6px" }} />
                                        <button onClick={saveShares} style={{ marginTop: "4px" }}>Save</button>
                                    </div>
                                </>
                            )}
                            {selected.shareWithEmails && selected.shareWithEmails.length > 0 && (
                                <div style={{ marginTop: "8px", fontSize: "12px", color: "#888" }}>
                                    Shared: {selected.shareWithEmails.join(", ")}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {error && <div style={{ color: "#ef4444", marginTop: "12px" }}>{error}</div>}
        </div>
    );
}
