import React, { useState, useEffect, useRef, useMemo } from "react";
import {
    fetchLists,
    fetchListItem,
    createList,
    updateList,
    deleteList,
    createListItem,
    updateListItem,
    deleteListItem,
    reorderListItems,
    transferListItem,
    getUserIdFromToken,
} from "../utils";

function getCachedLists(userId) {
    try {
        const raw = localStorage.getItem(`dj_lists_${userId}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function setCachedLists(userId, data) {
    if (!userId) return;
    try {
        localStorage.setItem(`dj_lists_${userId}`, JSON.stringify(data));
    } catch {
        // quota exceeded – ignore
    }
}

function getCachedListItemDetails(userId) {
    try {
        const raw = localStorage.getItem(`dj_list_item_details_v1_${userId}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function setCachedListItemDetails(userId, data) {
    if (!userId) return;
    try {
        localStorage.setItem(`dj_list_item_details_v1_${userId}`, JSON.stringify(data));
    } catch {
        // quota exceeded – ignore
    }
}

export default function Lists({ token, selectedId: routeSelectedId, selectedItemId: routeSelectedItemId, onSelectList, onCloseList, onOpenItemDetails, onCloseItemDetails, onSelectedListTitle }) {
    const [lists, setLists] = useState([]);
    const userId = useMemo(() => getUserIdFromToken(token), [token]);
    const [listsLoaded, setListsLoaded] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [selectedItemDetails, setSelectedItemDetails] = useState(null);
    const [newName, setNewName] = useState("");
    const [titleDraft, setTitleDraft] = useState("");
    const [itemTextDraft, setItemTextDraft] = useState("");
    const [itemNoteDraft, setItemNoteDraft] = useState("");
    const [itemImagesDraft, setItemImagesDraft] = useState([]);
    const [itemSortMode, setItemSortMode] = useState("order");
    const [newNamePublic, setNewNamePublic] = useState(false);
    const [newItem, setNewItem] = useState("");
    const [shareInput, setShareInput] = useState("");
    const [error, setError] = useState("");
    const dragItemId = useRef(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [trashOver, setTrashOver] = useState(false);
    const dragListId = useRef(null);
    const longPressTimer = useRef(null);
    const [dragOverListId, setDragOverListId] = useState(null);
    const [showArchived, setShowArchived] = useState(false);
    const [transferItemId, setTransferItemId] = useState(null);
    const [transferTargetId, setTransferTargetId] = useState("");
    const [transferEnabled, setTransferEnabled] = useState(false);
    const selectedIdRef = useRef(null);
    const selectedItemIdRef = useRef(null);
    const selectedItemRef = useRef(null);
    const itemTextDraftRef = useRef("");
    const itemNoteDraftRef = useRef("");
    const pendingItemSaveRef = useRef(null);
    const flushPendingItemEditsRef = useRef(async () => { });
    const newItemInputRef = useRef(null);
    const itemDetailsCacheRef = useRef(new Map());
    const itemDetailsInFlightRef = useRef(new Map());
    const itemDetailsPersistTimerRef = useRef(null);

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

    const getItemDetailCacheKey = (listId, itemId) => `${String(listId || "")}:${String(itemId || "")}`;

    const getItemDetailVersion = (item) => {
        if (!item) return "";
        return JSON.stringify({
            text: String(item.text || ""),
            note: String(item.note || ""),
            done: !!item.done,
            imageCount: Number(item.imageCount || 0),
            updatedAt: item.updatedAt || "",
            hasAttachments: !!item.hasAttachments,
        });
    };

    const schedulePersistItemDetailsCache = () => {
        if (!userId) return;
        if (itemDetailsPersistTimerRef.current) {
            clearTimeout(itemDetailsPersistTimerRef.current);
        }
        itemDetailsPersistTimerRef.current = window.setTimeout(() => {
            setCachedListItemDetails(userId, Object.fromEntries(itemDetailsCacheRef.current));
            itemDetailsPersistTimerRef.current = null;
        }, 150);
    };

    const setItemDetailCacheEntry = (listId, itemId, detail, sourceItem = detail) => {
        const cacheKey = getItemDetailCacheKey(listId, itemId);
        itemDetailsCacheRef.current.set(cacheKey, {
            version: getItemDetailVersion(sourceItem),
            detail,
        });
        schedulePersistItemDetailsCache();
        return detail;
    };

    const getCachedItemDetail = (listId, itemId, sourceItem) => {
        const cacheKey = getItemDetailCacheKey(listId, itemId);
        const cached = itemDetailsCacheRef.current.get(cacheKey);
        if (!cached) return null;
        const expectedVersion = getItemDetailVersion(sourceItem);
        if (!expectedVersion || cached.version === expectedVersion) {
            return cached.detail;
        }
        return null;
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

    useEffect(() => {
        if (itemDetailsPersistTimerRef.current) {
            clearTimeout(itemDetailsPersistTimerRef.current);
            itemDetailsPersistTimerRef.current = null;
        }
        if (!userId) {
            itemDetailsCacheRef.current = new Map();
            itemDetailsInFlightRef.current = new Map();
            return;
        }
        const cached = getCachedListItemDetails(userId);
        itemDetailsCacheRef.current = new Map(Object.entries(cached || {}));
        itemDetailsInFlightRef.current = new Map();
    }, [userId]);

    useEffect(() => () => {
        if (itemDetailsPersistTimerRef.current) {
            clearTimeout(itemDetailsPersistTimerRef.current);
        }
    }, []);

    // load lists
    useEffect(() => {
        if (!token) return;
        // Show cached data immediately so the UI is never blank
        const cached = getCachedLists(userId);
        if (cached) {
            setLists(cached);
            setListsLoaded(true);
        } else {
            setListsLoaded(false);
        }
        // Background fetch – update only when data has actually changed
        fetchLists(authHeaders, { includeArchived: true })
            .then((fresh) => {
                setLists(fresh);
                setCachedLists(userId, fresh);
            })
            .catch((e) => {
                console.error(e);
                if (e.code === 401) return; // handled by parent
            })
            .finally(() => setListsLoaded(true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // keep lists cache in sync with any local mutations (create, update, delete, reorder)
    useEffect(() => {
        if (!userId || !listsLoaded) return;
        setCachedLists(userId, lists);
    }, [userId, lists, listsLoaded]);

    // keep selection synced with hash route when App drives this screen
    useEffect(() => {
        if (routeSelectedId === undefined) return;
        const nextSelectedId = routeSelectedId ? String(routeSelectedId) : null;
        const nextSelectedItemId = routeSelectedItemId ? String(routeSelectedItemId) : null;
        const currentSelectedId = selectedIdRef.current ? String(selectedIdRef.current) : null;
        const currentSelectedItemId = selectedItemIdRef.current ? String(selectedItemIdRef.current) : null;
        const leavingCurrentItem = Boolean(
            currentSelectedId &&
            currentSelectedItemId &&
            (currentSelectedId !== nextSelectedId || currentSelectedItemId !== nextSelectedItemId)
        );
        if (leavingCurrentItem) {
            void flushPendingItemEditsRef.current();
        }
        setSelectedId(routeSelectedId ? String(routeSelectedId) : null);
        setSelectedItemId(routeSelectedItemId ? String(routeSelectedItemId) : null);
        setNewItem("");
        setShareInput("");
        setError("");
        setTransferItemId(null);
        setTransferTargetId("");
        setTransferEnabled(false);
        setSelectedItemDetails(null);
    }, [routeSelectedId, routeSelectedItemId]);

    // sync title draft when the selected list or its name changes
    useEffect(() => {
        const list = lists.find((l) => getListId(l) === String(selectedId || ""));
        setTitleDraft(list?.name || "");
    }, [selectedId, lists]);

    const selectList = (id) => {
        const normalizedId = String(id || "");
        if (!normalizedId) return;
        if (onSelectList) {
            onSelectList(normalizedId);
        } else {
            setSelectedId(normalizedId);
            setSelectedItemId(null);
            setSelectedItemDetails(null);
        }
        setNewItem("");
        setShareInput("");
        setTransferItemId(null);
        setTransferTargetId("");
        setTransferEnabled(false);
    };

    const backToLists = async () => {
        await flushPendingItemEditsRef.current();
        if (onCloseList) {
            onCloseList();
        } else {
            setSelectedId(null);
            setSelectedItemId(null);
            setSelectedItemDetails(null);
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

    useEffect(() => {
        setDragOverIndex(null);
        dragItemId.current = null;
    }, [itemSortMode, selectedId]);

    const applyListUpdate = (updated) => {
        upsertList(updated);
    };

    const clearLongPressTimer = () => {
        if (!longPressTimer.current) return;
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
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
        setSelectedItemDetails(null);
    };

    const closeItemDetails = async () => {
        await flushPendingItemEditsRef.current();
        const selectedListId = String(selectedId || "");
        if (onCloseItemDetails && selectedListId) {
            onCloseItemDetails(selectedListId);
            return;
        }
        setSelectedItemId(null);
        setSelectedItemDetails(null);
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
            window.requestAnimationFrame(() => {
                newItemInputRef.current?.focus();
            });
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
                .then((fresh) => { setLists(fresh); setCachedLists(userId, fresh); })
                .catch(() => { });
        }
    };

    const selected = lists.find((l) => getListId(l) === String(selectedId || "")) || {};
    const selectedExists = Boolean(getListId(selected));
    const canReorderItems = !selected.archived && itemSortMode === "order";
    const displayItems = useMemo(() => {
        const items = [...(selected.items || [])];
        if (itemSortMode !== "alphabetical") return items;
        return items.sort((a, b) => {
            const byText = String(a.text || "").localeCompare(String(b.text || ""), undefined, {
                sensitivity: "base",
                numeric: true,
            });
            if (byText !== 0) return byText;
            return getItemId(a).localeCompare(getItemId(b));
        });
    }, [selected.items, itemSortMode]);
    const selectedItemSummary = (selected.items || []).find((item) => getItemId(item) === String(selectedItemId || "")) || null;
    const selectedItem = selectedItemDetails && getItemId(selectedItemDetails) === String(selectedItemId || "")
        ? selectedItemDetails
        : selectedItemSummary;

    useEffect(() => {
        selectedIdRef.current = selectedId ? String(selectedId) : null;
        selectedItemIdRef.current = selectedItemId ? String(selectedItemId) : null;
        selectedItemRef.current = selectedItem || null;
        itemTextDraftRef.current = itemTextDraft;
        itemNoteDraftRef.current = itemNoteDraft;
    }, [selectedId, selectedItemId, selectedItem, itemTextDraft, itemNoteDraft]);

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

    const fetchItemDetails = async (listId, itemId, options = {}) => {
        const normalizedListId = String(listId || "");
        const normalizedItemId = String(itemId || "");
        const sourceItem = options.sourceItem || null;
        const force = !!options.force;
        if (!normalizedListId || !normalizedItemId) return null;

        const cacheKey = getItemDetailCacheKey(normalizedListId, normalizedItemId);
        const cached = force ? null : getCachedItemDetail(normalizedListId, normalizedItemId, sourceItem);
        if (cached) return cached;

        const existingRequest = itemDetailsInFlightRef.current.get(cacheKey);
        if (existingRequest) return existingRequest;

        const request = fetchListItem(normalizedListId, normalizedItemId, authHeaders)
            .then((detail) => setItemDetailCacheEntry(normalizedListId, normalizedItemId, detail, sourceItem || detail))
            .finally(() => {
                itemDetailsInFlightRef.current.delete(cacheKey);
            });

        itemDetailsInFlightRef.current.set(cacheKey, request);
        return request;
    };

    const refreshSelectedItemDetails = async (listId, itemId, sourceItem) => {
        const detail = await fetchItemDetails(listId, itemId, { force: true, sourceItem });
        setSelectedItemDetails(detail);
        return detail;
    };

    useEffect(() => {
        const selectedListId = String(selectedId || "");
        const currentItemId = String(selectedItemId || "");
        if (!selectedListId || !currentItemId) {
            setSelectedItemDetails(null);
            return;
        }
        const sourceList = lists.find((list) => getListId(list) === selectedListId);
        const sourceItem = (sourceList?.items || []).find((item) => getItemId(item) === currentItemId) || null;
        const cachedDetail = getCachedItemDetail(selectedListId, currentItemId, sourceItem);
        setSelectedItemDetails(cachedDetail);
        let cancelled = false;
        fetchItemDetails(selectedListId, currentItemId, { sourceItem })
            .then((detail) => {
                if (cancelled) return;
                setSelectedItemDetails(detail);
            })
            .catch((e) => {
                if (cancelled) return;
                console.error(e);
                if (e.code !== 401) {
                    setError(formatActionError("Unable to load item details", e));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [selectedId, selectedItemId, token, lists]);

    useEffect(() => {
        if (!token || !listsLoaded) return;

        const pendingItems = [];
        for (const list of lists) {
            const listId = getListId(list);
            if (!listId) continue;
            for (const item of list.items || []) {
                const itemId = getItemId(item);
                if (!itemId) continue;
                if (getCachedItemDetail(listId, itemId, item)) continue;
                pendingItems.push({ listId, itemId, item });
            }
        }

        if (pendingItems.length === 0) return;

        let cancelled = false;
        let nextIndex = 0;
        const workerCount = Math.min(4, pendingItems.length);

        const runWorker = async () => {
            while (!cancelled) {
                const job = pendingItems[nextIndex];
                nextIndex += 1;
                if (!job) return;
                try {
                    await fetchItemDetails(job.listId, job.itemId, { sourceItem: job.item });
                } catch (e) {
                    if (e?.code !== 401) {
                        console.error(e);
                    }
                }
            }
        };

        void Promise.all(Array.from({ length: workerCount }, () => runWorker()));

        return () => {
            cancelled = true;
        };
    }, [lists, listsLoaded, token]);

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
            await refreshSelectedItemDetails(selectedListId, currentItemId, updated.items?.find((item) => getItemId(item) === currentItemId));
            setError("");
        } catch (e) {
            console.error(e);
            setError(formatActionError(errorMessage, e));
        }
    };

    const flushPendingItemEdits = async () => {
        if (pendingItemSaveRef.current) return pendingItemSaveRef.current;

        const currentListId = selectedIdRef.current ? String(selectedIdRef.current) : "";
        const currentItemId = selectedItemIdRef.current ? String(selectedItemIdRef.current) : "";
        const currentItem = selectedItemRef.current;
        if (!currentListId || !currentItemId || !currentItem) return;

        const nextText = itemTextDraftRef.current.trim();
        const currentText = String(currentItem.text || "");
        const nextNote = String(itemNoteDraftRef.current || "");
        const currentNote = String(currentItem.note || "");

        const changes = {};
        if (nextText && nextText !== currentText) {
            changes.text = nextText;
        }
        if (nextNote !== currentNote) {
            changes.note = nextNote;
        }

        if (!Object.keys(changes).length) return;

        const request = (async () => {
            try {
                const updated = await updateListItem(currentListId, currentItemId, changes, authHeaders);
                applyListUpdate(updated);
                setError("");
            } catch (e) {
                console.error(e);
                setError(formatActionError("Unable to save item changes", e));
            }
        })();

        pendingItemSaveRef.current = request;
        try {
            await request;
        } finally {
            pendingItemSaveRef.current = null;
        }
    };

    useEffect(() => {
        flushPendingItemEditsRef.current = flushPendingItemEdits;
    }, [flushPendingItemEdits]);

    const isPdfAttachment = (src) => {
        const normalized = String(src || "").toLowerCase();
        return normalized.startsWith("data:application/pdf") || normalized.includes(".pdf");
    };

    const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;

    const openPdf = (src) => {
        if (src.startsWith("data:")) {
            const [header, b64] = src.split(",");
            const mime = header.match(/:(.*?);/)[1];
            const bytes = atob(b64);
            const arr = new Uint8Array(bytes.length);
            for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
            const blob = new Blob([arr], { type: mime });
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank", "noopener,noreferrer");
        } else {
            window.open(src, "_blank", "noopener,noreferrer");
        }
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

    if (selectedId && !selectedExists && !listsLoaded) {
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

    if (selectedId && !selectedExists && listsLoaded) {
        return (
            <div style={{ minHeight: "calc(100vh - 180px)", display: "grid", gap: "12px" }}>
                <button
                    onClick={backToLists}
                    style={{ justifySelf: "start", background: "none", border: "none", color: "var(--accent-primary)", cursor: "pointer", fontSize: "14px", padding: 0 }}
                >
                    ← Back to lists
                </button>
                <div style={{ color: "var(--muted)" }}>List not found or no longer accessible.</div>
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
                                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "6px" }}>
                                            {!isMobile() && (
                                                <button
                                                    type="button"
                                                    onClick={() => openPdf(src)}
                                                    title="Open PDF"
                                                    aria-label="Open PDF"
                                                    style={{
                                                        height: "22px",
                                                        padding: "0 8px",
                                                        borderRadius: "999px",
                                                        border: "1px solid var(--border)",
                                                        background: "var(--surface)",
                                                        color: "var(--text)",
                                                        cursor: "pointer",
                                                        fontSize: "11px",
                                                        lineHeight: 1,
                                                    }}
                                                >
                                                    Open
                                                </button>
                                            )}
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
                                        {isMobile() ? (
                                            <button
                                                type="button"
                                                onClick={() => openPdf(src)}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "10px",
                                                    width: "100%",
                                                    padding: "14px 16px",
                                                    borderRadius: "8px",
                                                    border: "1px solid var(--border)",
                                                    background: "var(--surface)",
                                                    color: "var(--text)",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    textAlign: "left",
                                                }}
                                            >
                                                <span style={{ fontSize: "22px", lineHeight: 1 }}>📄</span>
                                                <span>Open PDF</span>
                                            </button>
                                        ) : (
                                            <embed
                                                src={src}
                                                type="application/pdf"
                                                style={{ width: "100%", minHeight: "220px", borderRadius: "8px", border: "1px solid var(--border)" }}
                                            />
                                        )}
                                    </div>
                                ) : (
                                    <div
                                        key={`${src}-${idx}`}
                                        style={{ display: "grid", gap: "6px" }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "6px" }}>
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
                                                🗑
                                            </button>
                                        </div>
                                        <img
                                            src={src}
                                            alt={`Note image ${idx + 1}`}
                                            style={{ maxWidth: "100%", borderRadius: "8px", border: "1px solid var(--border)" }}
                                        />
                                    </div>
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
                <div style={{ marginTop: "8px", marginBottom: "8px", display: "flex", justifyContent: "flex-end" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--muted)" }}>
                        <select
                            aria-label="Sort items"
                            value={itemSortMode}
                            onChange={(e) => setItemSortMode(e.target.value)}
                            style={{ ...inputStyle, padding: "6px", minWidth: "130px" }}
                        >
                            <option value="order">Order</option>
                            <option value="alphabetical">Alphabetical</option>
                        </select>
                    </label>
                </div>
                <div style={{ marginTop: "8px", marginBottom: "8px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                        ref={newItemInputRef}
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
                    {displayItems.map((it, idx) => (
                        <li
                            key={`${selectedId}-${getItemId(it)}-${it.updatedAt || ""}`}
                            draggable={canReorderItems}
                            onDragStart={() => {
                                if (!canReorderItems) return;
                                clearLongPressTimer();
                                dragItemId.current = getItemId(it);
                            }}
                            onMouseDown={(e) => startItemLongPress(getItemId(it), e)}
                            onMouseUp={clearLongPressTimer}
                            onMouseLeave={clearLongPressTimer}
                            onTouchStart={(e) => startItemLongPress(getItemId(it), e)}
                            onTouchEnd={clearLongPressTimer}
                            onTouchCancel={clearLongPressTimer}
                            onDragOver={(e) => {
                                if (!canReorderItems) return;
                                e.preventDefault();
                                setDragOverIndex(idx);
                            }}
                            onDrop={async () => {
                                if (!canReorderItems) return;
                                await reorderItems(idx);
                            }}
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
                                borderTop: canReorderItems && dragOverIndex === idx ? "2px solid var(--ring)" : "2px solid transparent",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <div
                                    aria-hidden="true"
                                    title="Drag item"
                                    style={{
                                        width: "12px",
                                        alignSelf: "stretch",
                                        borderRadius: "4px",
                                        background: "transparent",
                                        cursor: "grab",
                                        flexShrink: 0,
                                    }}
                                />
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
                                {(it.hasAttachments || String(it.note || "").trim() || Number(it.imageCount || 0) > 0) && (
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
                                <div
                                    aria-hidden="true"
                                    title="Drag item"
                                    style={{
                                        width: "12px",
                                        alignSelf: "stretch",
                                        borderRadius: "4px",
                                        background: "transparent",
                                        cursor: "grab",
                                        flexShrink: 0,
                                    }}
                                />
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
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "auto", paddingTop: "24px" }}>
                        <div style={{ width: "100%", display: "grid", gap: "8px" }}>
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
                                <div style={{ fontSize: "12px", display: "grid", gap: "2px" }}>
                                    <label style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px" }}>
                                        <input
                                            type="checkbox"
                                            checked={!!selected.publicIncludeNotes}
                                            onChange={async () => {
                                                try {
                                                    const updated = await updateList(selectedId, { publicIncludeNotes: !selected.publicIncludeNotes }, authHeaders);
                                                    applyListUpdate(updated);
                                                    setError("");
                                                } catch (e) {
                                                    console.error(e);
                                                    setError(formatActionError("Unable to update public notes visibility", e));
                                                }
                                            }}
                                        />{' '}
                                        Include item notes on public page
                                    </label>
                                    <div>
                                        Public views: {selected.publicViewCount || 0}
                                    </div>
                                    <div>
                                        Last viewed: {publicLastViewedAtLabel}
                                    </div>
                                    {selected.publicSlug && (
                                        <div>
                                            Slug URL: <a href={`/lists/public/${encodeURIComponent(selected.publicSlug)}`} style={{ color: "var(--muted)", textDecoration: "none" }}>/lists/public/{selected.publicSlug}</a>
                                        </div>
                                    )}
                                    {selected.publicId && (
                                        <div>
                                            UUID URL: <a href={`/lists/public/${selected.publicId}`} style={{ color: "var(--muted)", textDecoration: "none" }}>/lists/public/{selected.publicId}</a>
                                        </div>
                                    )}
                                </div>
                            )}
                            {!selected.archived && (
                                <label style={{ fontSize: "14px" }}>
                                    <input
                                        type="checkbox"
                                        checked={transferEnabled}
                                        onChange={(e) => setTransferEnabled(e.target.checked)}
                                    />{' '}
                                    Enable Share / Copy
                                </label>
                            )}
                        </div>
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
