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
    getWorldInfoPrompt, // <-- ADDED
} from '/scripts/world-info.js'; 

import { saveSettingsDebounced, getRequestHeaders, generateRaw, getMaxPromptTokens } from '/script.js'; // <-- ADDED generateRaw, getMaxPromptTokens
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


const STRICT_XML_TEMPLATES = {
    'NPC': `Output strictly using the predefined XML template below. Use brief descriptive words and phrases rather than narrative prose to minimize token count without losing content. Do not overly explain traits. If the user has requested expansion, addition, updating or elaboration, then use chat and lore context to fill or create missing information, inferring missing information based on known attributes or likely values.

Map synonymous attributes to their corresponding canonical tags (e.g., map "race" to <species>, "hometown" to <home>, etc.). Any additional details, traits, or attributes that do not clearly fit into the predefined schema MUST be placed inside <extra> using clean, descriptive sub-tags (e.g., <extra><title>...</title><weapon>...</weapon></extra>). 

Enumerate children sequentially inside <children> using self-closing tags (<child_1 name="" gender="" species="" dob="" />, <child_2 ... />, etc.). If none exist, leave <children></children> empty.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

Do not modify the predefined XML structure or add new parent tags.

<character_card>
<name></name>
<aliases></aliases>
<species></species>
<gender></gender>
<age></age>
<birthdate></birthdate>
<mother></mother>
<father></father>
<spouse></spouse>
<children>
\t<child_1 name="" gender="" species="" dob="" status="" />
</children>
<home></home>
<birthplace></birthplace>
<occupation></occupation>

<appearance>
\t<build></build>
\t<height></height>
\t<weight></weight>
\t<eyes></eyes>
\t<hair></hair>
\t<skin></skin>
\t<clothing></clothing>
\t<presence></presence>
\t<genitalia></genitalia>
</appearance>

<psychology>
\t<personality></personality>
\t<likes></likes>
\t<dislikes></dislikes>
\t<fears></fears>
\t<morality></morality>
</psychology>

<behaviors>
\t<mannerisms></mannerisms>
\t<speech_style></speech_style>
\t<combat_style></combat_style>
</behaviors>

<abilities>
\t<talents></talents>
\t<magical_power></magical_power>
</abilities>

<background>
\t<origin></origin>
\t<past_events></past_events>
</background>

<relationships>
\t<allies></allies>
\t<friends></friends>
\t<rivals></rivals>
</relationships>

<goals>
\t<goal_1></goal_1>
\t<goal_2></goal_2>
</goals>

<inventory>
</inventory>

<extra>
</extra>

<persistent_notes>
</persistent_notes>
</character_card>`,

    'Location': `Output strictly using the predefined XML template below. Use brief descriptive words and phrases rather than narrative prose to minimize token count without losing content. Map synonymous attributes to their canonical tags. Any attributes that do not fit into the predefined schema MUST be placed inside <extra> using clean, descriptive sub-tags.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

Do not modify the predefined XML structure.

<location_card>
<name></name>
<type></type>
<region></region>
<coordinates_or_position></coordinates_or_position>
<atmosphere></atmosphere>

<sensory>
\t<visual></visual>
\t<auditory></auditory>
\t<olfactory></olfactory>
</sensory>

<layout>
\t<landmarks></landmarks>
\t<points_of_interest></points_of_interest>
</layout>

<inhabitants>
\t<factions></factions>
\t<key_figures></key_figures>
</inhabitants>

<history_and_lore>
\t<origin></origin>
\t<events></events>
</history_and_lore>

<extra>
</extra>

<persistent_notes>
</persistent_notes>
</location_card>`,

    'Item': `Output strictly using the predefined XML template below. Use brief descriptive words and phrases rather than narrative prose to minimize token count without losing content. Map synonymous attributes to their canonical tags. Any attributes that do not fit into the predefined schema MUST be placed inside <extra> using clean, descriptive sub-tags.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

Do not modify the predefined XML structure.

<item_card>
<name></name>
<type></type>
<material></material>
<current_owner></current_owner>
<current_location></current_location>

<properties>
\t<physical></physical>
\t<magical_or_tech></magical_or_tech>
\t<limitations></limitations>
</properties>

<history>
\t<origin></origin>
\t<significance></significance>
</history>

<extra>
</extra>

<persistent_notes>
</persistent_notes>
</item_card>`,

    'Event': `Output strictly using the predefined XML template below. Use brief descriptive phrasing to minimize token count. Map synonymous attributes to canonical tags. Any extra details belong in <extra> with descriptive sub-tags.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

Do not modify the predefined XML structure.

<event_card>
<name></name>
<date_or_era></date_or_era>
<location></location>
<key_participants></key_participants>

<chronology>
\t<causes></causes>
\t<turning_points></turning_points>
\t<climax></climax>
</chronology>

<outcomes>
\t<immediate_results></immediate_results>
\t<long_term_consequences></long_term_consequences>
</outcomes>

<extra>
</extra>

<persistent_notes>
</persistent_notes>
</event_card>`,

    'Scene Summary': `Output strictly using the predefined XML template below. Use concise phrasing to minimize tokens. Map synonymous attributes to canonical tags. Any unmatched attributes belong inside <extra> with descriptive sub-tags.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

<scene_summary>
<setting></setting>
<active_characters></active_characters>
<key_decisions></key_decisions>
<unresolved_conflicts></unresolved_conflicts>
<immediate_stakes></immediate_stakes>
<extra>
</extra>

<persistent_notes>
</persistent_notes>
</scene_summary>`,

    'Scenario': `Output strictly using the predefined XML template below. Use brief phrasing to keep token count low. Map synonymous attributes to canonical tags. Any unmatched attributes belong inside <extra> with descriptive sub-tags.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

<scenario_card>
<title></title>
<plot_context></plot_context>
<objectives></objectives>
<active_threats></active_threats>
<environmental_constraints></environmental_constraints>
<extra>
</extra>

<persistent_notes>
</persistent_notes>
</scenario_card>`,

    'Rules': `Output strictly using the predefined XML template below. Keep mechanics and limitations concise. Map synonymous attributes to canonical tags. Any unmatched attributes belong inside <extra> with descriptive sub-tags.

CRITICAL INSTRUCTION FOR PERSISTENT NOTES: If the target entry contains a <persistent_notes> section, you MUST preserve the entire tag and its exact text content word-for-word without adding, modifying, or deleting anything inside it. If it was empty or not present, leave <persistent_notes></persistent_notes> empty.

<rule_definition>
<system_name></system_name>
<mechanics></mechanics>
<limitations></limitations>
<costs_and_side_effects></costs_and_side_effects>
<permitted_actions></permitted_actions>
<strictly_impossible></strictly_impossible>
<extra>
</extra>

<persistent_notes>
</persistent_notes>
</rule_definition>`
};

const FORMAT_INSTRUCTIONS = {
    'Narrative': 'Output as clean, cohesive narrative prose using well-structured paragraphs.',
    'Key: Value': 'Output strictly as a list of `Key: Value` attributes (e.g., Name: ..., Status: ..., Traits: ...). Keep entries concise and easy to scan.',
    'XML Tagged': 'Output using clean XML tags to isolate distinct attributes (e.g., <appearance>...</appearance>, <traits>...</traits>, <history>...</history>).',
    'XML Strict Formatting': 'Output strictly matching the template provided for this category.'
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
    const { chat, name1, name2 } = context;

    // 1. Extract recent chat history & format for the WI scanner
    let formattedChatHistory = '(No recent chat history available)';
    let chatForWI = [];

    if (Array.isArray(chat) && chat.length > 0) {
        const recentMessages = chat.slice(-maxChatMessages);
        const coreChat = recentMessages.filter(msg => msg && !msg.is_system);

        formattedChatHistory = coreChat
            .map(msg => `[${msg.name || (msg.is_user ? (name1 || 'User') : (name2 || 'Assistant'))}]: ${msg.mes}`)
            .join('\n\n');

        // The ST WI scanner expects a reversed array of strings
        chatForWI = coreChat.map(x => world_info_include_names ? `${x.name || (x.is_user ? (name1 || 'User') : (name2 || 'Assistant'))}: ${x.mes}` : x.mes).reverse();
    }

    // 2. Fetch Triggered World Info Manually
    const maxContext = typeof getMaxPromptTokens === 'function' ? getMaxPromptTokens() : 4000;
    const globalScanData = { trigger: 'normal' };
    
    let activeLoreBlock = '';
    if (typeof getWorldInfoPrompt === 'function') {
        const wiData = await getWorldInfoPrompt(chatForWI, maxContext, false, globalScanData);
        const activeLore = [wiData.worldInfoBefore, wiData.worldInfoAfter].filter(x => x).join('\n\n').trim();
        if (activeLore) {
            activeLoreBlock = `[ACTIVE LORE & WORLD INFO]\n${activeLore}\n`;
        }
    }

    // 3. Assemble Custom Prompt
    const typeGuidance = LORE_TYPE_INSTRUCTIONS[loreType] || LORE_TYPE_INSTRUCTIONS['NPC'];
    
    // --- CHANGED HERE ---
    let formatGuidance = FORMAT_INSTRUCTIONS[format] || FORMAT_INSTRUCTIONS['Narrative'];
    if (format === 'XML Strict Formatting') {
        formatGuidance = STRICT_XML_TEMPLATES[loreType] || STRICT_XML_TEMPLATES['NPC'];
    }
    // --------------------

    const userInstructions = updatePrompt?.trim() || 'Update and refine this entry to reflect recent developments in the chat history.';

    // This acts as the actual System Prompt, completely replacing ST's global roleplay sysprompt
    const systemPromptOverride = `[SYSTEM MANDATE — OVERRIDE ALL ROLEPLAY INSTRUCTIONS]
ATTENTION: STOP ROLEPLAYING IMMEDIATELY.
DO NOT ACT AS ANY CHARACTER. DO NOT CONTINUE THE STORY. DO NOT GENERATE DIALOGUE.
YOU ARE AN OUT-OF-CHARACTER (OOC) TECHNICAL DOCUMENT EDITOR.
YOUR ONLY TASK IS TO REVISE THE LOREBOOK ENTRY PROVIDED BELOW BASED ON THE RECENT CHAT HISTORY.
OUTPUT ONLY THE REVISED LOREBOOK ENTRY CONTENT IN THE EXACT FORMAT REQUESTED. NO CONVERSATIONAL FILLER.`;

    // This acts as the User message
    const userPromptText = `[CATEGORY FOCUS: ${loreType.toUpperCase()}]
${typeGuidance}

[OUTPUT FORMAT REQUIREMENT: ${format.toUpperCase()}]
${formatGuidance}

${activeLoreBlock}
[RECENT CHAT HISTORY FOR CONTEXT]
${formattedChatHistory}

[TARGET LOREBOOK ENTRY TO REVISE]
Title: ${currentEntry.comment || 'Untitled'}
Keywords: ${(currentEntry.key || []).join(', ')}
Current Content:
${currentEntry.content || '(Empty)'}

[USER REVISION INSTRUCTIONS]
${userInstructions}`;

    // 4. Call generateRaw directly, bypassing ST's roleplay pipeline
    if (typeof generateRaw !== 'function') {
        throw new Error('generateRaw function is not available. Ensure you are on a compatible version of SillyTavern.');
    }

    const response = await generateRaw({
        prompt: userPromptText.trim(),
        systemPrompt: systemPromptOverride,
        instructOverride: false, // Ensures your normal Instruct Mode tags (User/System/Assistant) are wrapped around the prompt
        quietToLoud: false
    });

    if (!response) {
        throw new Error('Received empty response from AI text generation.');
    }

    let cleaned = String(response).trim();

    return cleaned
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();
}