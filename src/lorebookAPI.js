import {
    world_names,
    selected_world_info,
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    deleteWorldInfoEntry,
    createNewWorldInfo,
    updateWorldInfoList,
    importWorldInfo,
    deleteWorldInfo,
    world_info,
    world_info_depth,
    world_info_budget,
    world_info_budget_cap,
    world_info_min_activations,
    world_info_min_activations_depth_max,
    world_info_max_recursion_steps,
    world_info_character_strategy,
    world_info_include_names,
    world_info_recursive,
    world_info_case_sensitive,
    world_info_match_whole_words,
    world_info_use_group_scoring,
    world_info_overflow_alert,
    updateWorldInfoSettings,
} from '/scripts/world-info.js'; 

import { saveSettingsDebounced, getRequestHeaders } from '/script.js';
import { download } from '/scripts/utils.js';

const wiDataCache = new Map();

export function clearWICache() {
    wiDataCache.clear();
}

export function invalidateWICache(name) {
    wiDataCache.delete(name);
}

export function getAllWorldNames() {
    return world_names || [];
}

export function getActiveWorldNames() {
    return selected_world_info || [];
}

export function isWorldActive(name) {
    return (selected_world_info || []).includes(name);
}

export async function activateWorld(name) {
    if (!selected_world_info.includes(name)) {
        selected_world_info.push(name);
        await updateWorldInfoList();
        $('#world_info').trigger('change');
    }
}

export async function deactivateWorld(name) {
    const idx = selected_world_info.indexOf(name);
    if (idx !== -1) {
        selected_world_info.splice(idx, 1);
        await updateWorldInfoList();
        $('#world_info').trigger('change');
    }
}

export async function loadWorldData(name, forceReload = false) {
    if (!forceReload && wiDataCache.has(name)) {
        return wiDataCache.get(name);
    }
    const data = await loadWorldInfo(name);
    if (data) {
        wiDataCache.set(name, data);
    }
    return data;
}

export async function saveWorldData(name, data) {
    wiDataCache.set(name, data);
    await saveWorldInfo(name, data, true);
}

export function createEntry(name, data) {
    return createWorldInfoEntry(name, data);
}

export async function deleteEntry(data, uid) {
    await deleteWorldInfoEntry(data, uid, { silent: true });
}

export async function createNewWorld(name) {
    await createNewWorldInfo(name, { interactive: false });
}

export async function deleteWorld(name) {
    await deactivateWorld(name);

    const response = await fetch('/api/worldinfo/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name }),
    });

    if (!response.ok) {
        throw new Error(`Failed to delete lorebook "${name}": ${response.statusText}`);
    }

    const idx = world_names.indexOf(name);
    if (idx !== -1) {
        world_names.splice(idx, 1);
    }

    invalidateWICache(name);
    await updateWorldInfoList();
}

export function getEntryCount(data) {
    if (!data || !data.entries) return 0;
    return Object.keys(data.entries).length;
}

export function estimateTokens(data) {
    if (!data || !data.entries) return 0;
    let totalChars = 0;
    for (const entry of Object.values(data.entries)) {
        if (entry.content) totalChars += entry.content.length;
        if (entry.key && Array.isArray(entry.key)) totalChars += entry.key.join(', ').length;
        if (entry.keysecondary && Array.isArray(entry.keysecondary)) totalChars += entry.keysecondary.join(', ').length;
    }
    return Math.round(totalChars / 3.5);
}

export function getEntriesSorted(data, sortMode = 'order') {
    if (!data || !data.entries) return [];
    const items = Object.entries(data.entries).map(([uid, entry]) => ({ uid: Number(uid), entry }));

    return items.sort((a, b) => {
        switch (sortMode) {
            case 'title': {
                const titleA = (a.entry.comment || `Entry ${a.uid}`).toLowerCase();
                const titleB = (b.entry.comment || `Entry ${b.uid}`).toLowerCase();
                return titleA.localeCompare(titleB);
            }
            case 'tokens': {
                const tokA = a.entry.content?.length || 0;
                const tokB = b.entry.content?.length || 0;
                return tokB - tokA;
            }
            case 'status': {
                const getStatusRank = (e) => {
                    if (e.disable) return 0;
                    if (e.constant) return 3;
                    if (e.vectorized) return 2;
                    return 1;
                };
                return getStatusRank(b.entry) - getStatusRank(a.entry);
            }
            case 'order':
            default:
                return (b.entry.order ?? 100) - (a.entry.order ?? 100);
        }
    });
}

export function updateEntryField(data, uid, field, value) {
    if (data && data.entries && data.entries[uid] !== undefined) {
        data.entries[uid][field] = value;
    }
}

export function getGlobalWISettings() {
    return {
        world_info_depth,
        world_info_budget,
        world_info_budget_cap,
        world_info_min_activations,
        world_info_min_activations_depth_max,
        world_info_max_recursion_steps,
        world_info_character_strategy,
        world_info_include_names,
        world_info_recursive,
        world_info_case_sensitive,
        world_info_match_whole_words,
        world_info_use_group_scoring,
        world_info_overflow_alert,
    };
}

export function setGlobalWISetting(key, value) {
    updateWorldInfoSettings({ [key]: value });

    const $nativeEl = $(`#${key}`);
    if ($nativeEl.length) {
        if ($nativeEl.is(':checkbox')) {
            $nativeEl.prop('checked', Boolean(value)).trigger('change');
        } else {
            $nativeEl.val(value).trigger('input');
        }
    }

    saveSettingsDebounced();
}

export async function importWorld(file) {
    await importWorldInfo(file);
}

export async function renameWorld(oldName, newName) {
    const data = await loadWorldData(oldName, true);
    if (!data) throw new Error(`Could not load world data for "${oldName}"`);

    const wasActive = selected_world_info.includes(oldName);

    await saveWorldInfo(newName, data, true);
    await deleteWorldInfo(oldName);

    if (wasActive) {
        selected_world_info.push(newName);
        saveSettingsDebounced();
    }

    const existingCharLores = world_info?.charLore?.filter(e => e.extraBooks.includes(oldName));
    if (existingCharLores && existingCharLores.length > 0) {
        existingCharLores.forEach(charLore => {
            charLore.extraBooks = charLore.extraBooks.filter(e => e !== oldName).concat(newName);
        });
        saveSettingsDebounced();
    }

    wiDataCache.delete(oldName);
    wiDataCache.set(newName, data);

    await updateWorldInfoList();
}

export async function exportWorld(name) {
    const data = await loadWorldData(name, true);
    if (!data) return;
    download(JSON.stringify(data), `${name}.json`, 'application/json');
}