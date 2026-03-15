import React, { useState, useEffect, useRef } from "react";
import {
    fetchLists,
    createList,
    updateList,
    deleteList,
    createListItem,
    updateListItem,
    deleteListItem,
    reorderListItems,
    transferListItem,
} from "../utils";

export default function Lists({ token, socket, selectedId: routeSelectedId, selectedItemId: routeSelectedItemId, onSelectList, onCloseList, onOpenItemDetails, onCloseItemDetails, onSelectedListTitle }) {
    const [lists, setLists] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [newName, setNewName] = useState("");
    const [titleDraft, setTitleDraft] = useState("");
    const [itemTextDraft, setItemTextDraft] = useState("");
    const [itemNoteDraft, setItemNoteDraft] = useState("");
    const [itemImagesDraft, setItemImagesDraft] = useState([]);
    const [newNamePublic, setNewNamePublic] = useState(false);
    const [newItem, setNewItem] = useState("");
    const [shareInput, setShareInput] = useState("");
    const [error, setError] = useState("");
    const dragItemId = useRef(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [trashOver, setTrashOver] = useState(false);
    const dragListId = useRef(null);
    const longPressTimer = useRef(null);
    const attachmentLongPressTimer = useRef(null);
    const [dragOverListId, setDragOverListId] = useState(null);
    const [showArchived, setShowArchived] = useState(false);
    const [transferItemId, setTransferItemId] = useState(null);
    const [transferTargetId, setTransferTargetId] = useState("");
    const [transferEnabled, setTransferEnabled] = useState(false);

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

    const getItemId = (item) => {
        if (!item) return "";
        return String(item.id ?? item.itemId ?? "");
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
        setSelectedItemId(routeSelectedItemId ? String(routeSelectedItemId) : null);
        setNewItem("");
        setShareInput("");
        setError("");
        setTransferItemId(null);
        setTransferTargetId("");
        setTransferEnabled(false);
    }, [routeSelectedId, routeSelectedItemId]);

    // sync title draft when the selected list or its name changes
    useEffect(() => {
        const list = lists.find((l) => getListId(l) === String(selectedId || ""));
        setTitleDraft(list?.name || "");
    }, [selectedId, lists]);

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
            setSelectedItemId(null);
        }
        setNewItem("");
        setShareInput("");
        setTransferItemId(null);
        setTransferTargetId("");
        setTransferEnabled(false);
    };

    const backToLists = () => {
        if (onCloseList) {
            onCloseList();
        } else {
            setSelectedId(null);
            setSelectedItemId(null);
        }
        setNewItem("");
        setShareInput("");
        setError("");
        setTransferItemId(null);
        setTransferTargetId("");
        setTransferEnabled(false);
    };

    useEffect(() => {
        if (transferEnabled) return;
        setTransferItemId(null);
        setTransferTargetId("");
    }, [transferEnabled]);

    const applyListUpdate = (updated) => {
        upsertList(updated);
    };

    const clearLongPressTimer = () => {
        if (!longPressTimer.current) return;
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
    };

    const clearAttachmentLongPressTimer = () => {
        if (!attachmentLongPressTimer.current) return;
        clearTimeout(attachmentLongPressTimer.current);
        attachmentLongPressTimer.current = null;
    };

    const openItemDetails = (itemId) => {
        const selectedListId = String(selectedId || "");
        const normalizedItemId = String(itemId || "");
        if (!selectedListId || !normalizedItemId) return;
        if (onOpenItemDetails) {
            onOpenItemDetails(selectedListId, normalizedItemId);
            return;
        }
        setSelectedItemId(normalizedItemId);
    };

    const closeItemDetails = () => {
        const selectedListId = String(selectedId || "");
        if (onCloseItemDetails && selectedListId) {
            onCloseItemDetails(selectedListId);
            return;
        }
        setSelectedItemId(null);
    };

    const startItemLongPress = (itemId, event) => {
        if (selected.archived) return;
        if (!itemId) return;
        const target = event?.target;
        if (target?.closest && target.closest("button, select, textarea, a, label, input[type='checkbox']")) {
            return;
        }
        clearLongPressTimer();
        longPressTimer.current = setTimeout(() => {
            openItemDetails(itemId);
            longPressTimer.current = null;
        }, 550);
    };

    useEffect(() => {
        return () => {
            clearLongPressTimer();
            clearAttachmentLongPressTimer();
        };
    }, []);

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
        try {
            const updated = await createListItem(selectedListId, { text: newItem.trim() }, authHeaders);
            applyListUpdate(updated);
            setNewItem("");
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to add item", e));
        }
    };

    const toggleItem = async (itemId) => {
        const selectedListId = String(selectedId || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        if (!list) return;
        const item = (list.items || []).find((entry) => getItemId(entry) === itemId);
        if (!item) return;
        try {
            const updated = await updateListItem(selectedListId, itemId, { done: !item.done }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to toggle item", e));
        }
    };

    const renameItem = async (itemId, value) => {
        const selectedListId = String(selectedId || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        if (!list) return;
        const text = value.trim();
        const item = (list.items || []).find((entry) => getItemId(entry) === itemId);
        if (!text || text === item?.text) return;
        try {
            const updated = await updateListItem(selectedListId, itemId, { text }, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to rename item", e));
        }
    };

    const deleteItem = async (itemId) => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId || !itemId) return;
        try {
            const updated = await deleteListItem(selectedListId, itemId, authHeaders);
            applyListUpdate(updated);
            if (transferItemId === itemId) {
                setTransferItemId(null);
                setTransferTargetId("");
            }
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to delete item", e));
        }
    };

    const reorderItems = async (targetIndex) => {
        const selectedListId = String(selectedId || "");
        const draggedItemId = String(dragItemId.current || "");
        const list = lists.find((l) => getListId(l) === selectedListId);
        const items = [...(list?.items || [])];
        const fromIndex = items.findIndex((item) => getItemId(item) === draggedItemId);
        if (!selectedListId || !draggedItemId || fromIndex === -1 || fromIndex === targetIndex) {
            setDragOverIndex(null);
            dragItemId.current = null;
            return;
        }

        const reordered = [...items];
        const [moved] = reordered.splice(fromIndex, 1);
        reordered.splice(targetIndex, 0, moved);

        try {
            const updated = await reorderListItems(selectedListId, reordered.map((item) => getItemId(item)), authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to reorder items", e));
        } finally {
            setDragOverIndex(null);
            dragItemId.current = null;
        }
    };

    const openTransferPanel = (itemId) => {
        const nextItemId = transferItemId === itemId ? null : itemId;
        setTransferItemId(nextItemId);
        if (nextItemId && !transferTargetId) {
            const fallbackTarget = activeLists.find((list) => getListId(list) !== String(selectedId || ""));
            setTransferTargetId(getListId(fallbackTarget));
        }
        if (!nextItemId) {
            setTransferTargetId("");
        }
    };

    const handleTransferItem = async (itemId, mode) => {
        const selectedListId = String(selectedId || "");
        if (!selectedListId || !itemId || !transferTargetId) return;
        try {
            const result = await transferListItem(selectedListId, itemId, { targetListId: transferTargetId, mode }, authHeaders);
            if (result?.targetList) {
                applyListUpdate(result.targetList);
            }
            setTransferItemId(null);
            setTransferTargetId("");
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError(`Unable to ${mode} item`, e));
        }
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
    const selectedItem = (selected.items || []).find((item) => getItemId(item) === String(selectedItemId || "")) || null;
    const activeLists = sortLists(lists.filter((l) => !l.archived));
    const archivedLists = sortLists(lists.filter((l) => l.archived));
    const transferTargets = sortLists(lists.filter((list) => getListId(list) !== String(selectedId || "")));
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

    useEffect(() => {
        setItemTextDraft(selectedItem?.text || "");
        setItemNoteDraft(selectedItem?.note || "");
        setItemImagesDraft(Array.isArray(selectedItem?.images) ? selectedItem.images : []);
    }, [selectedItemId, selectedItem?.text, selectedItem?.note, selectedItem?.images]);

    const saveItemDetails = async (changes, errorMessage) => {
        const selectedListId = String(selectedId || "");
        const currentItemId = String(selectedItemId || "");
        if (!selectedListId || !currentItemId) return;
        try {
            const updated = await updateListItem(selectedListId, currentItemId, changes, authHeaders);
            applyListUpdate(updated);
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError(errorMessage, e));
        }
    };

    const isPdfAttachment = (src) => {
        const normalized = String(src || "").toLowerCase();
        return normalized.startsWith("data:application/pdf") || normalized.includes(".pdf");
    };

    const appendImageToNote = async (file) => {
        if (!file) return;
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf";
        if (!isImage && !isPdf) return;

        const asDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Unable to read file"));
            reader.readAsDataURL(file);
        });

        await saveItemDetails({ addImage: asDataUrl }, "Unable to add image to item");
    };

    const handleNoteImagePick = async (event) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        try {
            await appendImageToNote(file);
        } catch (e) {
            console.error(e);
            setError(formatActionError("Unable to add image", e));
        } finally {
            event.target.value = "";
        }
    };

    const removeAttachment = async (source) => {
        if (selected.archived) return;
        const normalizedSource = String(source || "").trim();
        if (!normalizedSource) return;
        const shouldDelete = window.confirm("Delete this attachment?");
        if (!shouldDelete) return;
        await saveItemDetails({ removeImage: normalizedSource }, "Unable to delete attachment");
    };

    const startAttachmentLongPress = (source) => {
        if (selected.archived) return;
        const normalizedSource = String(source || "").trim();
        if (!normalizedSource) return;
        clearAttachmentLongPressTimer();
        attachmentLongPressTimer.current = setTimeout(() => {
            removeAttachment(normalizedSource);
            attachmentLongPressTimer.current = null;
        }, 550);
    };

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

    if (selectedId && selectedItemId) {
        if (!selectedItem) {
            return (
                <div style={{ minHeight: "calc(100vh - 180px)", display: "grid", gap: "12px" }}>
                    <button
                        onClick={closeItemDetails}
                        style={{ justifySelf: "start", background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", fontSize: "14px", padding: 0 }}
                    >
                        ← Back to list
                    </button>
                    <div style={{ color: "var(--muted)" }}>Item not found.</div>
                    {error && <div style={{ color: "var(--error)" }}>{error}</div>}
                </div>
            );
        }

        return (
            <div style={{ minHeight: "calc(100vh - 180px)", display: "grid", gap: "12px" }}>
                <button
                    onClick={closeItemDetails}
                    style={{ justifySelf: "start", background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", fontSize: "14px", padding: 0 }}
                >
                    ← Back to list
                </button>
                <h4 style={{ margin: 0 }}>Item details</h4>

                <label style={{ display: "grid", gap: "6px", fontSize: "13px", color: "var(--muted)" }}>
                    Item
                    <input
                        value={itemTextDraft}
                        onChange={(e) => setItemTextDraft(e.target.value)}
                        onBlur={() => {
                            const nextText = itemTextDraft.trim();
                            if (!nextText || nextText === (selectedItem.text || "")) return;
                            saveItemDetails({ text: nextText }, "Unable to update item text");
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        style={{ ...inputStyle, padding: "8px" }}
                    />
                </label>

                <label style={{ display: "grid", gap: "6px", fontSize: "13px", color: "var(--muted)" }}>
                    Note
                    <textarea
                        value={itemNoteDraft}
                        onChange={(e) => setItemNoteDraft(e.target.value)}
                        onBlur={() => {
                            if (itemNoteDraft === (selectedItem.note || "")) return;
                            saveItemDetails({ note: itemNoteDraft }, "Unable to update item note");
                        }}
                        rows={5}
                        style={{
                            ...inputStyle,
                            padding: "8px",
                            resize: "vertical",
                            minHeight: "110px",
                            fontFamily: "inherit",
                        }}
                    />
                </label>

                {itemImagesDraft.length > 0 && (
                    <div style={{ display: "grid", gap: "8px" }}>
                        <div style={{ display: "grid", gap: "8px" }}>
                            {itemImagesDraft.map((src, idx) => (
                                isPdfAttachment(src) ? (
                                    <div
                                        key={`${src}-${idx}`}
                                        style={{ display: "grid", gap: "6px" }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                            <button
                                                type="button"
                                                onClick={() => removeAttachment(src)}
                                                title="Delete attachment"
                                                aria-label="Delete attachment"
                                                style={{
                                                    width: "22px",
                                                    height: "22px",
                                                    borderRadius: "999px",
                                                    border: "1px solid var(--border)",
                                                    background: "var(--surface)",
                                                    color: "var(--error)",
                                                    cursor: "pointer",
                                                    fontSize: "12px",
                                                    lineHeight: 1,
                                                    padding: 0,
                                                }}
                                            >
                                                x
                                            </button>
                                        </div>
                                        <embed
                                            src={src}
                                            type="application/pdf"
                                            style={{ width: "100%", minHeight: "220px", borderRadius: "8px", border: "1px solid var(--border)" }}
                                        />
                                    </div>
                                ) : (
                                    <img
                                        key={`${src}-${idx}`}
                                        src={src}
                                        alt={`Note image ${idx + 1}`}
                                        title="Long press to delete attachment"
                                        onMouseDown={() => startAttachmentLongPress(src)}
                                        onMouseUp={clearAttachmentLongPressTimer}
                                        onMouseLeave={clearAttachmentLongPressTimer}
                                        onTouchStart={() => startAttachmentLongPress(src)}
                                        onTouchEnd={clearAttachmentLongPressTimer}
                                        onTouchCancel={clearAttachmentLongPressTimer}
                                        style={{ maxWidth: "100%", borderRadius: "8px", border: "1px solid var(--border)" }}
                                    />
                                )
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ display: "grid", gap: "8px" }}>
                    <label style={{ fontSize: "14px" }}>
                        Add image / PDF
                        <input
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={handleNoteImagePick}
                            style={{ display: "block", marginTop: "6px", fontSize: "12px", color: "var(--muted)" }}
                        />
                    </label>
                </div>

                <label style={{ fontSize: "14px" }}>
                    <input
                        type="checkbox"
                        checked={!!selectedItem.done}
                        onChange={() => saveItemDetails({ done: !selectedItem.done }, "Unable to update item status")}
                    />{' '}
                    Mark complete
                </label>

                {error && <div style={{ color: "var(--error)" }}>{error}</div>}
            </div>
        );
    }

    if (selectedId) {
        return (
            <div style={{ minHeight: "calc(100vh + 220px)", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
                    <input
                        value={titleDraft}
                        onChange={e => setTitleDraft(e.target.value)}
                        onBlur={() => {
                            const trimmed = titleDraft.trim();
                            if (trimmed && trimmed !== selected.name) changeName(trimmed);
                        }}
                        disabled={!isOwner || !!selected.archived}
                        style={{
                            ...inputStyle,
                            fontSize: "22px",
                            padding: "10px 12px",
                            opacity: isOwner ? 1 : 0.7,
                            background: isOwner ? inputStyle.background : "var(--surface-soft)",
                        }}
                    />
                </div>

                <h4 style={{ margin: 0 }}>Items</h4>
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
                            if (dragItemId.current) {
                                const itemId = dragItemId.current;
                                dragItemId.current = null;
                                await deleteItem(itemId);
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
                            key={`${selectedId}-${getItemId(it)}-${it.updatedAt || ""}`}
                            draggable
                            onDragStart={() => {
                                clearLongPressTimer();
                                dragItemId.current = getItemId(it);
                            }}
                            onMouseDown={(e) => startItemLongPress(getItemId(it), e)}
                            onMouseUp={clearLongPressTimer}
                            onMouseLeave={clearLongPressTimer}
                            onTouchStart={(e) => startItemLongPress(getItemId(it), e)}
                            onTouchEnd={clearLongPressTimer}
                            onTouchCancel={clearLongPressTimer}
                            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
                            onDrop={async () => { await reorderItems(idx); }}
                            onDragEnd={() => {
                                clearLongPressTimer();
                                setDragOverIndex(null);
                                setTrashOver(false);
                                dragItemId.current = null;
                            }}
                            style={{
                                display: "grid",
                                gap: "6px",
                                marginBottom: "8px",
                                borderTop: dragOverIndex === idx ? "2px solid var(--ring)" : "2px solid transparent",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <input
                                    type="checkbox"
                                    checked={it.done}
                                    onChange={() => toggleItem(getItemId(it))}
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
                                    onBlur={(e) => renameItem(getItemId(it), e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") e.currentTarget.blur();
                                    }}
                                    style={{
                                        ...inputStyle,
                                        flex: 1,
                                        padding: "6px",
                                        color: it.done ? "var(--muted)" : "var(--text)",
                                    }}
                                    disabled={!!selected.archived}
                                />
                                {(String(it.note || "").trim() || (Array.isArray(it.images) && it.images.length > 0)) && (
                                    <button
                                        type="button"
                                        onClick={() => openItemDetails(getItemId(it))}
                                        title="Has note details"
                                        aria-label="Has note details"
                                        style={{
                                            background: "none",
                                            border: "none",
                                            padding: 0,
                                            fontSize: "14px",
                                            color: "var(--muted)",
                                            lineHeight: 1,
                                            flexShrink: 0,
                                            cursor: "pointer",
                                        }}
                                    >
                                        📝
                                    </button>
                                )}
                                {!selected.archived && transferEnabled && (
                                    <button
                                        type="button"
                                        onClick={() => openTransferPanel(getItemId(it))}
                                        style={{
                                            ...createButtonStyle,
                                            padding: "6px 10px",
                                            fontSize: "12px",
                                        }}
                                    >
                                        {transferItemId === getItemId(it) ? "Close" : "Share / Copy"}
                                    </button>
                                )}
                            </div>
                            {transferEnabled && transferItemId === getItemId(it) && (
                                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", paddingLeft: "22px" }}>
                                    {transferTargets.length > 0 ? (
                                        <>
                                            <select
                                                value={transferTargetId}
                                                onChange={(e) => setTransferTargetId(e.target.value)}
                                                style={{ ...inputStyle, padding: "6px", minWidth: "180px" }}
                                            >
                                                <option value="" disabled>Select destination</option>
                                                {transferTargets.map((list) => (
                                                    <option key={getListId(list)} value={getListId(list)}>
                                                        {list.archived ? `${list.name} (archived)` : list.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => handleTransferItem(getItemId(it), "share")}
                                                disabled={!transferTargetId}
                                                style={{ ...createButtonStyle, padding: "6px 10px", fontSize: "12px" }}
                                            >
                                                Share
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleTransferItem(getItemId(it), "copy")}
                                                disabled={!transferTargetId}
                                                style={{ ...createButtonStyle, padding: "6px 10px", fontSize: "12px" }}
                                            >
                                                Copy
                                            </button>
                                        </>
                                    ) : (
                                        <div style={{ color: "var(--muted)", fontSize: "12px" }}>
                                            Create another list first, then you can share or copy this item.
                                        </div>
                                    )}
                                </div>
                            )}
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
                        {!selected.archived && (
                            <div style={{ marginTop: "8px" }}>
                                <label style={{ fontSize: "14px" }}>
                                    <input
                                        type="checkbox"
                                        checked={transferEnabled}
                                        onChange={(e) => setTransferEnabled(e.target.checked)}
                                    />{' '}
                                    Enable Share / Copy
                                </label>
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
