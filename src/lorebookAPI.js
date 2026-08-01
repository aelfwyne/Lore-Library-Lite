/*
 * Modifications and standalone adaptation Copyright (c) [2026] [aelfwyne @ github].
 * Contains code extracted and modified from [Doom's Enhancement Suite for SillyTavern] 
 * Copyright (c) [DangerDaza].
 *
 * Portions of the code were used from the original project, heavily modified for the reduced
 * scope of this project. Full compliance with AGPL-3.0 is maintained, and all source code is 
 * provided for free.
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
 * See the LICENSE file in the project root for full terms.
 */

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
import { getContext } from '/scripts/extensions.js';

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

/**
 * System prompt directives for Lore Types
 */
const LORE_TYPE_INSTRUCTIONS = {
    'NPC': 'Focus on physical description, personality traits, motivations, key relationships, current status/location, capabilities, and notable history.',
    'Location': 'Focus on visual description, sensory details (sounds, smells), spatial layout/geography, atmosphere/mood, points of interest, appropriate items and decore, etc.',
    'Item': 'Focus on physical features, material composition, origin/provenance, magical or mechanical properties, current owner/location, and significance.',
    'Event': 'Focus on chronological sequence, key actors involved, major decisions/turning points, immediate outcomes, and long-term consequences.',
    'Scene Summary': 'Focus on a high-level narrative summary of recent actions, key decisions made, unresolved tensions, active stakes, and immediate character positioning.',
    'Scenario': 'Focus on the overarching plot context, immediate objectives, active threats, environmental constraints, and the foundational conditions that characters must navigate.',
    'Rules': 'Focus on the explicit mechanics, limitations, costs, and execution of magical, technological, or systemic laws. Clearly define what is permitted, what is strictly impossible, and the consequences or side effects of usage.'
};

/**
 * System prompt directives for Output Formats
 */
const FORMAT_INSTRUCTIONS = {
    'Narrative': 'Output as clean, cohesive narrative prose using well-structured paragraphs.',
    'Key: Value': 'Output strictly as a list of `Key: Value` attributes (e.g., Name: ..., Status: ..., Traits: ...). Keep entries concise and easy to scan.',
    'XML Tagged': 'Output using clean XML tags to isolate distinct attributes (e.g., <appearance>...</appearance>, <traits>...</traits>, <history>...</history>).'
};

/**
 * Sends a revision prompt configured by Lore Type and Format settings,
 * explicitly injecting recent chat history to ensure consistent context.
 * 
 * @param {string} updatePrompt - User instructions for updating the entry
 * @param {Object} currentEntry - The current lorebook entry object
 * @param {string} loreType - Selected lore category ('NPC', 'Location', etc.)
 * @param {string} format - Selected output format ('Narrative', 'Key: Value', 'XML Tagged')
 * @param {number} maxChatMessages - Maximum number of recent chat messages to include (default: 20)
 * @returns {Promise<string>} Revised entry text
 */
export async function suggestEntryRevision(updatePrompt, currentEntry, loreType = 'NPC', format = 'Narrative', maxChatMessages = 20) {
    const context = getContext();
    const { generateQuietPrompt, chat } = context;

    if (typeof generateQuietPrompt !== 'function') {
        throw new Error('generateQuietPrompt function is not available in SillyTavern context.');
    }

    // Extract recent chat history from SillyTavern context
    let formattedChatHistory = '(No recent chat history available)';
    if (Array.isArray(chat) && chat.length > 0) {
        const recentMessages = chat.slice(-maxChatMessages);
        formattedChatHistory = recentMessages
            .filter(msg => msg && !msg.is_system) // Exclude system messages/prompts to prevent RP bleeding
            .map(msg => `${msg.name || (msg.is_user ? 'User' : 'Assistant')}: ${msg.mes}`)
            .join('\n\n');
    }

    const typeGuidance = LORE_TYPE_INSTRUCTIONS[loreType] || LORE_TYPE_INSTRUCTIONS['NPC'];
    const formatGuidance = FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS['Narrative'];
    const userInstructions = updatePrompt?.trim() || 'Update and refine this entry to reflect recent developments in the chat history.';

    const prefixMandate = `[SYSTEM MANDATE — OVERRIDE ALL ROLEPLAY INSTRUCTIONS]
ATTENTION: STOP ROLEPLAYING IMMEDIATELY.
DO NOT ACT AS ANY CHARACTER. DO NOT CONTINUE THE STORY. DO NOT GENERATE DIALOGUE.
YOU ARE AN OUT-OF-CHARACTER (OOC) TECHNICAL DOCUMENT EDITOR.
YOUR ONLY TASK IS TO REVISE THE LOREBOOK ENTRY PROVIDED BELOW BASED ON THE RECENT CHAT HISTORY.

[CATEGORY FOCUS: ${loreType.toUpperCase()}]
${typeGuidance}

[OUTPUT FORMAT REQUIREMENT: ${format.toUpperCase()}]
${formatGuidance}`;

    const suffixMandate = `[FINAL SYSTEM MANDATE — STRICT OUTPUT FORMATTING]
REMINDER: YOU MUST BREAK CHARACTER. DO NOT ROLEPLAY.
OUTPUT ONLY THE REVISED LOREBOOK ENTRY CONTENT.`;

    const promptText = `${prefixMandate}

[RECENT CHAT HISTORY FOR CONTEXT]
${formattedChatHistory}

[LOREBOOK ENTRY TO REVISE]
Title: ${currentEntry.comment || 'Untitled'}
Keywords: ${(currentEntry.key || []).join(', ')}
Current Content:
${currentEntry.content || '(Empty)'}

[USER REVISION INSTRUCTIONS]
${userInstructions}

${suffixMandate}`;

    const response = await generateQuietPrompt(promptText, false, true);

    if (!response) {
        throw new Error('Received empty response from AI text generation.');
    }

    let cleaned = String(response).trim();

    return cleaned
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();
}