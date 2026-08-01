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

import { getSettings, saveSettings } from '../index.js';
import * as lorebookAPI from './lorebookAPI.js';
import * as campaignManager from './campaignManager.js';
import { getLorebookModal } from './lorebookModal.js';
import { escapeHtml } from './utils.js';

const CAMPAIGN_ICONS = [
    'fa-dragon', 'fa-hat-wizard', 'fa-wand-sparkles', 'fa-shield-halved',
    'fa-skull-crossbones', 'fa-crown', 'fa-dungeon',
    'fa-rocket', 'fa-robot', 'fa-atom', 'fa-satellite', 'fa-meteor', 'fa-user-astronaut',
    'fa-mountain-sun', 'fa-tree', 'fa-water', 'fa-globe', 'fa-seedling',
    'fa-ghost', 'fa-heart', 'fa-masks-theater', 'fa-gun', 'fa-car', 'fa-city',
    'fa-house', 'fa-scroll',
    'fa-folder', 'fa-book', 'fa-star', 'fa-fire', 'fa-bolt', 'fa-gem',
];

const CAMPAIGN_COLORS = [
    '#e94560', '#e07b39', '#f0c040', '#2ecc71', '#1abc9c',
    '#4a7ba7', '#9b59b6', '#e84393', '#95a5a6', '',
];

function buildIconPickerHtml(campaignId, currentIcon, currentColor) {
    let html = `<div class="rpg-lb-icon-picker" data-campaign="${campaignId}">`;
    html += '<div class="rpg-lb-icon-grid">';
    for (const icon of CAMPAIGN_ICONS) {
        const isSelected = icon === currentIcon ? ' selected' : '';
        html += `<button class="rpg-lb-icon-option${isSelected}" data-icon="${icon}" title="${icon.replace('fa-', '')}"><i class="fa-solid ${icon}"></i></button>`;
    }
    html += '</div><div class="rpg-lb-color-row">';
    for (const color of CAMPAIGN_COLORS) {
        const isSelected = color === currentColor ? ' selected' : '';
        if (color) {
            html += `<button class="rpg-lb-color-swatch${isSelected}" data-color="${color}" style="background:${color};" title="${color}"></button>`;
        } else {
            html += `<button class="rpg-lb-color-swatch${isSelected}" data-color="" title="Default"><i class="fa-solid fa-xmark"></i></button>`;
        }
    }
    html += '</div></div>';
    return html;
}

let saveDebounceTimer = null;
function debouncedSave(worldName, data) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        lorebookAPI.saveWorldData(worldName, data);
    }, 500);
}

let searchDebounceTimer = null;

async function renderEntriesForBook(worldName, container, preloadedData = null) {
    container.innerHTML = '<div class="rpg-lb-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading entries...</div>';

    const data = preloadedData || await lorebookAPI.loadWorldData(worldName);
    if (!data) {
        container.innerHTML = '<div class="rpg-lb-loading">Failed to load world data.</div>';
        return;
    }

    const sorted = lorebookAPI.getEntriesSorted(data);
    let html = '';

    for (const { uid, entry } of sorted) {
        html += buildEntryHtml(worldName, uid, entry);
    }

    html += `<button class="rpg-lb-btn-add-entry" data-world="${escapeHtml(worldName)}"><i class="fa-solid fa-plus"></i> Add Entry</button>`;

    container.innerHTML = html;

    const spineEl = container.previousElementSibling;
    if (spineEl) {
        const metaEl = spineEl.querySelector('.rpg-lb-spine-meta');
        const tokenEl = spineEl.querySelector('.rpg-lb-spine-tokens');
        if (metaEl) metaEl.textContent = `${sorted.length} entries`;
        if (tokenEl) tokenEl.textContent = `~${lorebookAPI.estimateTokens(data)} tok`;
    }
}

function buildEntryHtml(worldName, uid, entry) {
    const w = escapeHtml(worldName);
    const isEnabled = !entry.disable;
    const titleText = entry.comment || `Entry ${uid}`;
    const tokEst = Math.round((entry.content?.length || 0) / 3.5);

    let header = `<div class="rpg-lb-entry-header">`;
    header += `<i class="fa-solid fa-chevron-right rpg-lb-entry-chevron"></i>`;
    header += `<div class="rpg-lb-toggle ${isEnabled ? 'active' : ''}" data-type="entry" data-world="${w}" data-uid="${uid}"></div>`;
    header += `<select class="rpg-lb-state-select" data-world="${w}" data-uid="${uid}" data-field="entryState" title="Entry Status">`;
    header += `<option value="normal" ${!entry.constant && !entry.vectorized ? 'selected' : ''}>&#x1F7E2;</option>`;
    header += `<option value="constant" ${entry.constant ? 'selected' : ''}>&#x1F535;</option>`;
    header += `<option value="vectorized" ${entry.vectorized ? 'selected' : ''}>&#x1F517;</option>`;
    header += `</select>`;
    header += `<span class="rpg-lb-entry-title"><i class="fa-solid fa-scroll"></i> ${escapeHtml(titleText)}</span>`;
	const posBadgeMap = { 0: '↑Char', 1: '↓Char', 2: '↑AN', 3: '↓AN', 4: '@D', 5: '↑EM', 6: '↓EM', 7: 'Outlet' };
    header += `<span class="rpg-lb-entry-badge">${posBadgeMap[entry.position] ?? '↑Char'} ${entry.position == 4 ? 'd' + (entry.depth ?? 4) : ''}</span>`;
    header += `<span class="rpg-lb-entry-badge">~${tokEst} tok</span>`;
    header += `<div class="rpg-lb-entry-order-inline"><span>Order</span><input type="number" value="${entry.order ?? 100}" min="0" max="9999" data-world="${w}" data-uid="${uid}" data-field="order"></div>`;
    header += `<div class="rpg-lb-entry-actions">`;
    header += `<button class="rpg-lb-entry-action-btn rpg-lb-entry-delete" data-world="${w}" data-uid="${uid}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;
    header += `</div></div>`;

    let body = `<div class="rpg-lb-entry-body">`;
    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-tag"></i> Title / Memo</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.comment || '')}" data-world="${w}" data-uid="${uid}" data-field="comment"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-fingerprint"></i> UID</div><input class="rpg-lb-input" type="text" value="${uid}" disabled style="opacity:0.5;text-align:center;"></div>`;
    body += `</div></div>`;

    const posVal = entry.position ?? 0;
    const roleVal = entry.role ?? 0;
    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group md"><div class="rpg-lb-field-label"><i class="fa-solid fa-location-dot"></i> Position</div>`;
    body += `<select class="rpg-lb-select rpg-lb-position-select" data-world="${w}" data-uid="${uid}" data-field="position">`;
    body += `<option value="0" data-role="" ${posVal == 0 ? 'selected' : ''}>&#8593;Char &#8212; Before Char Defs</option>`;
    body += `<option value="1" data-role="" ${posVal == 1 ? 'selected' : ''}>&#8595;Char &#8212; After Char Defs</option>`;
    body += `<option value="2" data-role="" ${posVal == 2 ? 'selected' : ''}>&#8593;AN &#8212; Before Author's Note</option>`;
    body += `<option value="3" data-role="" ${posVal == 3 ? 'selected' : ''}>&#8595;AN &#8212; After Author's Note</option>`;
    body += `<option value="4" data-role="0" ${posVal == 4 && roleVal == 0 ? 'selected' : ''}>@D &#9881;&#65039; &#8212; At Depth (System)</option>`;
    body += `<option value="4" data-role="1" ${posVal == 4 && roleVal == 1 ? 'selected' : ''}>@D &#128100; &#8212; At Depth (User)</option>`;
    body += `<option value="4" data-role="2" ${posVal == 4 && roleVal == 2 ? 'selected' : ''}>@D &#129302; &#8212; At Depth (Assistant)</option>`;
    body += `<option value="5" data-role="" ${posVal == 5 ? 'selected' : ''}>&#8593;EM &#8212; Before Examples</option>`;
    body += `<option value="6" data-role="" ${posVal == 6 ? 'selected' : ''}>&#8595;EM &#8212; After Examples</option>`;
    body += `<option value="7" data-role="" ${posVal == 7 ? 'selected' : ''}>&#10145;&#65039; Outlet</option>`;
    body += `</select></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-layer-group"></i> Depth</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.depth ?? 4}" data-world="${w}" data-uid="${uid}" data-field="depth"></div>`;
    body += `</div>`;
    body += `<div class="rpg-lb-form-row rpg-lb-outlet-row" ${posVal != 7 ? 'style="display:none;"' : ''}>`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-plug"></i> Outlet Name</div>`;
    body += `<input class="rpg-lb-input" type="text" value="${escapeHtml(entry.outletName || '')}" data-world="${w}" data-uid="${uid}" data-field="outletName" placeholder="Outlet Name"></div>`;
    body += `</div></div>`;

    body += `<div class="rpg-lb-keywords-card">`;
    body += `<div class="rpg-lb-kw-section"><div class="rpg-lb-kw-section-header"><div class="rpg-lb-field-label"><i class="fa-solid fa-key"></i> Primary Keywords</div></div>`;
    body += `<textarea class="rpg-lb-input rpg-lb-kw-textarea" data-world="${w}" data-uid="${uid}" data-field="key" rows="2" placeholder="Comma-separated keywords">${(entry.key || []).join(', ')}</textarea></div>`;
    body += `<div class="rpg-lb-kw-section"><div class="rpg-lb-kw-section-header"><div class="rpg-lb-field-label"><i class="fa-solid fa-key"></i> Secondary Keywords</div>`;
    body += `<select class="rpg-lb-kw-logic-select" data-world="${w}" data-uid="${uid}" data-field="selectiveLogic">`;
    body += `<option value="0" ${entry.selectiveLogic == 0 ? 'selected' : ''}>AND ANY</option>`;
    body += `<option value="1" ${entry.selectiveLogic == 1 ? 'selected' : ''}>AND ALL</option>`;
    body += `<option value="2" ${entry.selectiveLogic == 2 ? 'selected' : ''}>NOT ALL</option>`;
    body += `<option value="3" ${entry.selectiveLogic == 3 ? 'selected' : ''}>NOT ANY</option>`;
    body += `</select></div>`;
    body += `<textarea class="rpg-lb-input rpg-lb-kw-textarea secondary" data-world="${w}" data-uid="${uid}" data-field="keysecondary" rows="2" placeholder="Comma-separated secondary keywords">${(entry.keysecondary || []).join(', ')}</textarea></div>`;
    body += `</div>`;

    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-field-label"><i class="fa-solid fa-align-left"></i> Content</div>`;
    body += `<textarea class="rpg-lb-textarea" data-world="${w}" data-uid="${uid}" data-field="content" rows="4">${escapeHtml(entry.content || '')}</textarea>`;
    body += `<div class="rpg-lb-content-footer">`;
    body += `<span class="rpg-lb-token-count"><i class="fa-solid fa-coins"></i> ~${tokEst} tokens</span>`;
    body += `<label class="rpg-lb-wi-checkbox"><input type="checkbox" ${entry.selective ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="selective"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> Selective</label>`;
    body += `</div></div>`;

    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-sort-numeric-up"></i> Order</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.order ?? 100}" data-world="${w}" data-uid="${uid}" data-field="order"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-percent"></i> Trigger %</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.probability ?? 100}" data-world="${w}" data-uid="${uid}" data-field="probability"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-magnifying-glass"></i> Scan Depth</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.scanDepth ?? ''}" placeholder="Global" data-world="${w}" data-uid="${uid}" data-field="scanDepth"></div>`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-object-group"></i> Inclusion Group</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.group || '')}" placeholder="Group label" data-world="${w}" data-uid="${uid}" data-field="group"></div>`;
    body += `</div></div>`;

    body += `<div class="rpg-lb-section-divider collapsed"><i class="fa-solid fa-sliders"></i> Advanced Options <i class="fa-solid fa-chevron-down rpg-lb-section-toggle"></i></div>`;
    body += `<div class="rpg-lb-collapsible-section" style="display:none;">`;

    body += `<div class="rpg-lb-form-row">`;
    body += buildTriStateSelect(w, uid, 'caseSensitive', 'Case Sensitive', entry.caseSensitive);
    body += buildTriStateSelect(w, uid, 'matchWholeWords', 'Match Whole Words', entry.matchWholeWords);
    body += buildTriStateSelect(w, uid, 'useGroupScoring', 'Group Scoring', entry.useGroupScoring);
    body += `</div>`;

    body += `<div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label">Group Weight</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.groupWeight ?? 100}" data-world="${w}" data-uid="${uid}" data-field="groupWeight"></div>`;
    body += `<div class="rpg-lb-field-group" style="display:flex;align-items:flex-end;padding-bottom:2px;"><label class="rpg-lb-wi-checkbox"><input type="checkbox" ${entry.groupOverride ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="groupOverride"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> Prioritize in group</label></div>`;
    body += `</div>`;

    body += `<div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-thumbtack"></i> Sticky</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.sticky ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="sticky"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-clock"></i> Cooldown</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.cooldown ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="cooldown"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-hourglass-start"></i> Delay</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.delay ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="delay"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-repeat"></i> Recursion Lv</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.delayUntilRecursion ?? 0}" data-world="${w}" data-uid="${uid}" data-field="delayUntilRecursion"></div>`;
    body += `</div>`;

    body += `<div class="rpg-lb-wi-checkbox-row">`;
    body += buildCheckbox(w, uid, 'excludeRecursion', 'Non-recursable', entry.excludeRecursion);
    body += buildCheckbox(w, uid, 'preventRecursion', 'Prevent recursion', entry.preventRecursion);
    body += buildCheckbox(w, uid, 'ignoreBudget', 'Ignore budget', entry.ignoreBudget);
    body += buildCheckbox(w, uid, 'useProbability', 'Use probability', entry.useProbability !== false);
    body += buildCheckbox(w, uid, 'constant', 'Constant', entry.constant);
    body += `</div>`;

    body += `<div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-bolt"></i> Automation ID</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.automationId || '')}" placeholder="( None )" data-world="${w}" data-uid="${uid}" data-field="automationId"></div>`;
    body += `</div>`;

    body += `</div></div>`;

    return `<div class="rpg-lb-entry" data-world="${w}" data-uid="${uid}">${header}${body}</div>`;
}

function buildTriStateSelect(w, uid, field, label, value) {
    return `<div class="rpg-lb-field-group md"><div class="rpg-lb-field-label">${label}</div><select class="rpg-lb-select" data-world="${w}" data-uid="${uid}" data-field="${field}"><option value="null" ${value === null || value === undefined ? 'selected' : ''}>Use global</option><option value="true" ${value === true ? 'selected' : ''}>Yes</option><option value="false" ${value === false ? 'selected' : ''}>No</option></select></div>`;
}

function buildCheckbox(w, uid, field, label, checked) {
    return `<label class="rpg-lb-wi-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="${field}"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> ${label}</label>`;
}

export function renderMobileLorebook() {
    const container = document.querySelector('#rpg-lorebook-modal .rpg-lb-modal-body');
    if (!container) return;

    const allNames = lorebookAPI.getAllWorldNames();
    const activeNames = lorebookAPI.getActiveWorldNames();
    const campaigns = campaignManager.getCampaignsInOrder();
    const unfiled = campaignManager.getUnfiledBooks();
    const settings = getSettings();
    const lb = settings.lorebook || {};
    const lastTab = lb.lastActiveTab || 'all';
    const lastFilter = lb.lastFilter || 'all';

    const totalActiveCount = activeNames.length;
    let activeCount = 0;
    let html = '';

    const gs = lorebookAPI.getGlobalWISettings();
    html += '<div class="rpg-lb-global-settings">';
    html += '<div class="rpg-lb-global-settings-header"><i class="fa-solid fa-sliders"></i> <span>Global WI Settings</span>';
    html += '<i class="fa-solid fa-chevron-right rpg-lb-global-chevron"></i></div>';
    html += '<div class="rpg-lb-global-settings-body" style="display:none;">';
    html += '<div class="rpg-lb-global-row">';
    html += `<div class="rpg-lb-global-field"><label>Scan Depth</label><input type="number" data-global="world_info_depth" value="${gs.world_info_depth}" min="0" max="1000"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Context %</label><input type="number" data-global="world_info_budget" value="${gs.world_info_budget}" min="1" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Budget Cap</label><input type="number" data-global="world_info_budget_cap" value="${gs.world_info_budget_cap}" min="0" max="65536"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Min Activations</label><input type="number" data-global="world_info_min_activations" value="${gs.world_info_min_activations}" min="0" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Max Depth</label><input type="number" data-global="world_info_min_activations_depth_max" value="${gs.world_info_min_activations_depth_max}" min="0" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Max Recursion</label><input type="number" data-global="world_info_max_recursion_steps" value="${gs.world_info_max_recursion_steps}" min="0" max="10"></div>`;
    html += '</div>';
    html += '<div class="rpg-lb-global-row">';
    html += '<div class="rpg-lb-global-field wide"><label>Insertion Strategy</label>';
    html += `<select data-global="world_info_character_strategy">`;
    html += `<option value="0" ${gs.world_info_character_strategy == 0 ? 'selected' : ''}>Sorted Evenly</option>`;
    html += `<option value="1" ${gs.world_info_character_strategy == 1 ? 'selected' : ''}>Character Lore First</option>`;
    html += `<option value="2" ${gs.world_info_character_strategy == 2 ? 'selected' : ''}>Global Lore First</option>`;
    html += '</select></div>';
    html += '</div>';
    html += '<div class="rpg-lb-global-row checkboxes">';
    html += `<label><input type="checkbox" data-global="world_info_include_names" ${gs.world_info_include_names ? 'checked' : ''}> Include Names</label>`;
    html += `<label><input type="checkbox" data-global="world_info_recursive" ${gs.world_info_recursive ? 'checked' : ''}> Recursive Scan</label>`;
    html += `<label><input type="checkbox" data-global="world_info_case_sensitive" ${gs.world_info_case_sensitive ? 'checked' : ''}> Case Sensitive</label>`;
    html += `<label><input type="checkbox" data-global="world_info_match_whole_words" ${gs.world_info_match_whole_words ? 'checked' : ''}> Match Whole Words</label>`;
    html += `<label><input type="checkbox" data-global="world_info_use_group_scoring" ${gs.world_info_use_group_scoring ? 'checked' : ''}> Use Group Scoring</label>`;
    html += `<label><input type="checkbox" data-global="world_info_overflow_alert" ${gs.world_info_overflow_alert ? 'checked' : ''}> Alert On Overflow</label>`;
    html += '</div>';
    html += '</div></div>';

    html += '<div class="rpg-lb-tab-bar">';
    html += `<div class="rpg-lb-tab ${lastTab === 'all' ? 'active' : ''}" data-tab="all">All</div>`;
    for (const { id, campaign } of campaigns) {
        const hasActiveBooks = (campaign.books || []).some(b => activeNames.includes(b));
        html += `<div class="rpg-lb-tab ${lastTab === id ? 'active' : ''}" data-tab="${id}">`;
        html += `<span class="rpg-lb-tab-dot ${hasActiveBooks ? 'has-active' : ''}"></span> ${escapeHtml(campaign.name)}`;
        html += '</div>';
    }
    html += `<div class="rpg-lb-tab ${lastTab === 'unfiled' ? 'active' : ''}" data-tab="unfiled">Unfiled</div>`;
    html += '<div class="rpg-lb-tab-add" title="New Lore Library"><i class="fa-solid fa-plus"></i></div>';
    html += '</div>';

    html += '<div class="rpg-lb-filter-row">';
    html += '<div class="rpg-lb-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>';
    html += `<input type="text" class="rpg-lb-search" placeholder="Search lorebooks..." value="${escapeHtml(lb.lastSearch || '')}">`;
    html += '</div>';
    html += '<div class="rpg-lb-filter-pills">';
    html += `<button class="rpg-lb-fpill ${lastFilter === 'all' || !lastFilter ? 'active' : ''}" data-filter="all">All</button>`;
    html += `<button class="rpg-lb-fpill ${lastFilter === 'active' ? 'active' : ''}" data-filter="active">Active</button>`;
    html += `<button class="rpg-lb-fpill ${lastFilter === 'inactive' ? 'active' : ''}" data-filter="inactive">Inactive</button>`;
    html += '</div></div>';

    html += '<div class="rpg-lb-toolbar">';
    html += '<button class="rpg-lb-toolbar-btn accent" data-action="apply-order"><i class="fa-solid fa-arrow-down-1-9"></i> Apply Current Sorting as Order</button>';
    html += '<span class="rpg-lb-spacer"></span>';
    html += '<button class="rpg-lb-toolbar-btn" data-action="expand-all"><i class="fa-solid fa-angles-down"></i> Expand All</button>';
    html += '<div class="rpg-lb-toolbar-sep"></div>';
    html += '<button class="rpg-lb-toolbar-btn" data-action="collapse-all"><i class="fa-solid fa-angles-up"></i> Collapse All</button>';
    html += '</div>';

    html += '<div class="rpg-lb-book-list">';

    for (const { id, campaign } of campaigns) {
        const isCollapsed = campaignManager.isCampaignCollapsed(id);
        const books = (campaign.books || []).filter(b => allNames.includes(b));
        const activeInCampaign = books.filter(b => activeNames.includes(b)).length;
        activeCount += activeInCampaign;

        html += `<div class="rpg-lb-campaign-group" data-campaign="${id}">`;
        html += `<div class="rpg-lb-campaign-header ${isCollapsed ? 'collapsed' : ''}" data-campaign="${id}">`;
        const iconClass = campaign.icon || 'fa-folder';
        const iconColor = campaign.color ? ` style="color: ${escapeHtml(campaign.color)};"` : '';
        html += `<i class="fa-solid ${escapeHtml(iconClass)} rpg-lb-campaign-icon" data-campaign="${id}"${iconColor} title="Click to change icon"></i>`;
        html += `<span class="rpg-lb-campaign-name">${escapeHtml(campaign.name)}</span>`;
        html += `<span class="rpg-lb-campaign-stats">${activeInCampaign}/${books.length} active</span>`;
        const allBooksActive = books.length > 0 && activeInCampaign === books.length;
        html += `<div class="rpg-lb-toggle rpg-lb-campaign-toggle ${allBooksActive ? 'active' : ''}" data-type="campaign" data-campaign="${id}" title="Toggle all books in this library"></div>`;
        html += `<button class="rpg-lb-campaign-delete" data-campaign="${id}" title="Delete library"><i class="fa-solid fa-trash"></i></button>`;
        html += `<i class="fa-solid fa-chevron-down rpg-lb-campaign-chevron"></i>`;
        html += '</div>';
        html += `<div class="rpg-lb-campaign-body" ${isCollapsed ? 'style="display:none;"' : ''}>`;

        for (const worldName of books) {
            html += buildBookSpineHtml(worldName, id, activeNames);
        }

        html += '</div></div>';
    }

    if (unfiled.length > 0 || lastTab === 'all' || lastTab === 'unfiled') {
        const activeInUnfiled = unfiled.filter(b => activeNames.includes(b)).length;
        activeCount += activeInUnfiled;

        html += '<div class="rpg-lb-campaign-group unfiled-group" data-campaign="unfiled">';
        html += '<div class="rpg-lb-campaign-header" data-campaign="unfiled">';
        html += '<i class="fa-solid fa-folder-open rpg-lb-campaign-icon"></i>';
        html += `<span class="rpg-lb-campaign-name">Unfiled</span>`;
        html += `<span class="rpg-lb-campaign-stats">${unfiled.length} books</span>`;
        html += '<i class="fa-solid fa-chevron-down rpg-lb-campaign-chevron"></i>';
        html += '</div>';
        html += '<div class="rpg-lb-campaign-body">';

        for (const worldName of unfiled) {
            html += buildBookSpineHtml(worldName, '', activeNames);
        }

        html += '</div></div>';
    }

    html += '</div>';

    html += '<div class="rpg-lb-sticky-footer">';
    html += '<div class="rpg-lb-bulk-footer">';
    html += '<span class="rpg-lb-bulk-count">Selected: 0</span>';
    html += '<button class="rpg-lb-bulk-btn" data-action="select-all">Select All</button>';
    html += '<button class="rpg-lb-bulk-btn rpg-lb-bulk-activate" data-action="activate">Activate</button>';
    html += '<button class="rpg-lb-bulk-btn rpg-lb-bulk-deactivate" data-action="deactivate">Deactivate</button>';
    html += '<div class="rpg-lb-move-dropdown">';
    html += '<button class="rpg-lb-bulk-btn" data-action="move">Move to &#9662;</button>';
    html += '</div>';
    html += '</div>';

    html += `<div class="rpg-lb-footer-stats">Active: ${activeCount} books | Total: ${allNames.length} lorebooks</div>`;

    html += '<div class="rpg-lb-new-book-row">';
    html += '<button class="rpg-lb-btn-new-book"><i class="fa-solid fa-plus"></i> New Lorebook</button>';
    html += '<button class="rpg-lb-btn-import"><i class="fa-solid fa-file-import"></i> Import</button>';
    html += '</div>';

    html += '</div>';
    html += '<input type="file" class="rpg-lb-import-file" accept=".json,.lorebook,.png" hidden>';

    container.innerHTML = html;

    applyTabFilter(container, lastTab);
    applyStatusFilter(container, lastFilter);

    const searchVal = (lb.lastSearch || '').trim().toLowerCase();
    if (searchVal) {
        applySearchFilter(container, searchVal);
    }

    const allGloballyActive = allNames.length > 0 && totalActiveCount === allNames.length;
    const $masterToggle = $('#rpg-lorebook-modal .rpg-lb-toggle[data-type="master"]');
    $masterToggle.toggleClass('active', allGloballyActive);
}

function buildBookSpineHtml(worldName, campaignId, activeNames) {
    const isActive = activeNames.includes(worldName);
    const w = escapeHtml(worldName);
    const cid = escapeHtml(campaignId);

    let html = '';
    html += `<div class="rpg-lb-book-spine expandable ${isActive ? 'active-book' : 'inactive'}" data-world="${w}" data-campaign="${cid}">`;
    html += '<i class="fa-solid fa-chevron-right rpg-lb-spine-chevron"></i>';
    html += '<div class="rpg-lb-book-check"><i class="fa-solid fa-check"></i></div>';
    html += `<div class="rpg-lb-toggle ${isActive ? 'active' : ''}" data-type="book" data-world="${w}"></div>`;
    html += '<i class="fa-solid fa-book rpg-lb-spine-icon"></i>';
    html += `<span class="rpg-lb-spine-name">${w}</span>`;
    html += '<span class="rpg-lb-spine-meta">? entries</span>';
    html += '<span class="rpg-lb-spine-tokens">...</span>';
    html += `<button class="rpg-lb-spine-export" data-world="${w}" title="Export"><i class="fa-solid fa-file-export"></i></button>`;
    html += `<button class="rpg-lb-spine-delete" data-world="${w}" title="Delete lorebook"><i class="fa-solid fa-trash"></i></button>`;
    html += '<button class="rpg-lb-spine-edit"><i class="fa-solid fa-pen-to-square"></i></button>';
    html += '</div>';
    html += `<div class="rpg-lb-lore-entries" data-world="${w}"></div>`;

    return html;
}

function applyTabFilter(container, tab) {
    const groups = container.querySelectorAll('.rpg-lb-campaign-group');
    for (const group of groups) {
        const gid = group.dataset.campaign;
        if (tab === 'all') {
            group.style.display = '';
        } else if (tab === 'unfiled') {
            group.style.display = gid === 'unfiled' ? '' : 'none';
        } else {
            group.style.display = gid === tab ? '' : 'none';
        }
    }
}

function applyStatusFilter(container, filter) {
    if (filter === 'all') return;
    const spines = container.querySelectorAll('.rpg-lb-book-spine');
    for (const spine of spines) {
        const isActive = spine.classList.contains('active-book');
        if (filter === 'active') {
            spine.style.display = isActive ? '' : 'none';
        } else if (filter === 'inactive') {
            spine.style.display = isActive ? 'none' : '';
        }
        const entries = spine.nextElementSibling;
        if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
            entries.style.display = spine.style.display;
        }
    }
}

function applySearchFilter(container, query) {
    const spines = container.querySelectorAll('.rpg-lb-book-spine');
    for (const spine of spines) {
        const name = (spine.dataset.world || '').toLowerCase();
        const matches = name.includes(query);
        if (!matches) {
            spine.style.display = 'none';
            const entries = spine.nextElementSibling;
            if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
                entries.style.display = 'none';
            }
        }
    }
}

function syncAllBookToggleStates($modal) {
    $modal.find('.rpg-lb-book-spine').each(function () {
        const $spine = $(this);
        const worldName = $spine.data('world');
        const isActive = lorebookAPI.isWorldActive(worldName);
        $spine.find('.rpg-lb-toggle[data-type="book"]').toggleClass('active', isActive);
        $spine.toggleClass('active-book', isActive).toggleClass('inactive', !isActive);
    });
}

function refreshActiveStats() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    const activeNames = lorebookAPI.getActiveWorldNames();
    const allNames = lorebookAPI.getAllWorldNames();
    let totalActive = 0;

    $modal.find('.rpg-lb-campaign-group').each(function () {
        const $group = $(this);
        const campaignId = $group.data('campaign');
        const $statsSpan = $group.find('.rpg-lb-campaign-stats').first();

        const spines = $group.find('.rpg-lb-book-spine');
        let groupTotal = 0;
        let groupActive = 0;

        spines.each(function () {
            const worldName = $(this).data('world');
            groupTotal++;
            if (activeNames.includes(worldName)) {
                groupActive++;
            }
        });

        totalActive += groupActive;

        if (campaignId === 'unfiled') {
            $statsSpan.text(`${groupTotal} books`);
        } else {
            $statsSpan.text(`${groupActive}/${groupTotal} active`);
        }
    });

    $modal.find('.rpg-lb-footer-stats').text(
        `Active: ${totalActive} books | Total: ${allNames.length} lorebooks`
    );
}

function refreshCampaignToggles() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    const activeNames = lorebookAPI.getActiveWorldNames();
    const allNames = lorebookAPI.getAllWorldNames();

    $modal.find('.rpg-lb-campaign-toggle').each(function () {
        const $toggle = $(this);
        const $group = $toggle.closest('.rpg-lb-campaign-group');
        const $spines = $group.find('.rpg-lb-book-spine');

        if ($spines.length === 0) {
            $toggle.removeClass('active');
            return;
        }

        let allActive = true;
        $spines.each(function () {
            const worldName = $(this).data('world');
            if (!activeNames.includes(worldName)) {
                allActive = false;
                return false;
            }
        });

        $toggle.toggleClass('active', allActive);
    });

    const allGloballyActive = allNames.length > 0 && activeNames.length >= allNames.length;
    $modal.find('.rpg-lb-toggle[data-type="master"]').toggleClass('active', allGloballyActive);
}

export function initMobileLorebookEventDelegation() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    $modal.on('click', '.rpg-lb-book-spine.expandable', function (e) {
        if ($(e.target).closest('.rpg-lb-toggle, .rpg-lb-book-check, .rpg-lb-spine-edit, .rpg-lb-spine-export, .rpg-lb-spine-delete').length) return;

        const $spine = $(this);
        const worldName = $spine.data('world');
        const $entries = $spine.next('.rpg-lb-lore-entries');

        $spine.toggleClass('expanded');
        $spine.find('.rpg-lb-spine-chevron').toggleClass('rotated');

        if ($spine.hasClass('expanded')) {
            if (!$entries.children().length || $entries.find('.rpg-lb-loading').length) {
                renderEntriesForBook(worldName, $entries[0]);
            }
            $entries.slideDown(200);
        } else {
            $entries.slideUp(200);
        }
    });

    $modal.on('click', '.rpg-lb-entry-header', function (e) {
        if ($(e.target).closest('.rpg-lb-toggle, .rpg-lb-entry-action-btn, .rpg-lb-entry-order-inline, .rpg-lb-state-select').length) return;

        const $header = $(this);
        const $body = $header.next('.rpg-lb-entry-body');

        $header.find('.rpg-lb-entry-chevron').toggleClass('rotated');
        $body.slideToggle(200);
    });

    $modal.on('click', '.rpg-lb-tab', function () {
        const tab = $(this).data('tab');
        $modal.find('.rpg-lb-tab').removeClass('active');
        $(this).addClass('active');
        campaignManager.setLastActiveTab(tab);

        const container = $modal.find('.rpg-lb-modal-body')[0];
        if (container) {
            applyTabFilter(container, tab);
            const lb = getSettings().lorebook || {};
            applyStatusFilter(container, lb.lastFilter || 'all');
            const search = (lb.lastSearch || '').trim().toLowerCase();
            if (search) applySearchFilter(container, search);
        }
    });

    $modal.on('click', '.rpg-lb-fpill', function () {
        const filter = $(this).data('filter');
        $modal.find('.rpg-lb-fpill').removeClass('active');
        $(this).addClass('active');
        campaignManager.setLastFilter(filter);

        const container = $modal.find('.rpg-lb-modal-body')[0];
        if (container) {
            container.querySelectorAll('.rpg-lb-book-spine').forEach(s => {
                s.style.display = '';
                const entries = s.nextElementSibling;
                if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
                    entries.style.display = '';
                }
            });
            const lb = getSettings().lorebook || {};
            applyTabFilter(container, lb.lastActiveTab || 'all');
            applyStatusFilter(container, filter);
            const search = (lb.lastSearch || '').trim().toLowerCase();
            if (search) applySearchFilter(container, search);
        }
    });

    $modal.on('click', '.rpg-lb-toolbar-btn[data-action="expand-all"]', function () {
        $modal.find('.rpg-lb-campaign-header.collapsed').each(function () {
            $(this).removeClass('collapsed');
            $(this).next('.rpg-lb-campaign-body').show();
        });
        $modal.find('.rpg-lb-book-spine.expandable:not(.expanded)').each(function () {
            const $spine = $(this);
            const worldName = $spine.data('world');
            const $entries = $spine.next('.rpg-lb-lore-entries');
            $spine.addClass('expanded');
            $spine.find('.rpg-lb-spine-chevron').addClass('rotated');
            if (!$entries.children().length || $entries.find('.rpg-lb-loading').length) {
                renderEntriesForBook(worldName, $entries[0]);
            }
            $entries.show();
        });
        $modal.find('.rpg-lb-entry-header').each(function () {
            $(this).find('.rpg-lb-entry-chevron').addClass('rotated');
            $(this).next('.rpg-lb-entry-body').show();
        });
    });

    $modal.on('click', '.rpg-lb-toolbar-btn[data-action="collapse-all"]', function () {
        $modal.find('.rpg-lb-campaign-header:not(.collapsed)').each(function () {
            const id = $(this).data('campaign');
            if (id && id !== 'unfiled') {
                if (!campaignManager.isCampaignCollapsed(id)) {
                    campaignManager.toggleCampaignCollapsed(id);
                }
            }
            $(this).addClass('collapsed');
            $(this).next('.rpg-lb-campaign-body').hide();
        });
        $modal.find('.rpg-lb-book-spine.expanded').each(function () {
            $(this).removeClass('expanded');
            $(this).find('.rpg-lb-spine-chevron').removeClass('rotated');
            $(this).next('.rpg-lb-lore-entries').hide();
        });
        $modal.find('.rpg-lb-entry-header').each(function () {
            $(this).find('.rpg-lb-entry-chevron').removeClass('rotated');
            $(this).next('.rpg-lb-entry-body').hide();
        });
    });

    $modal.on('click', '.rpg-lb-header-toggle', async function () {
        const allNames = lorebookAPI.getAllWorldNames();
        if (allNames.length === 0) return;

        const activeNames = lorebookAPI.getActiveWorldNames();
        const allActive = activeNames.length >= allNames.length;

        const $spines = $modal.find('.rpg-lb-book-spine');

        if (allActive) {
            for (const spine of $spines) {
                const worldName = $(spine).data('world');
                if (lorebookAPI.isWorldActive(worldName)) {
                    await lorebookAPI.deactivateWorld(worldName);
                }
            }
        } else {
            for (const spine of $spines) {
                const worldName = $(spine).data('world');
                if (!lorebookAPI.isWorldActive(worldName)) {
                    await lorebookAPI.activateWorld(worldName);
                }
            }
        }

        syncAllBookToggleStates($modal);
        refreshActiveStats();
        refreshCampaignToggles();
    });

    $modal.on('click', '.rpg-lb-toolbar-btn[data-action="apply-order"]', async function () {
        const spines = $modal.find('.rpg-lb-book-spine:visible');
        let order = spines.length * 10;

        for (const spine of spines) {
            const worldName = $(spine).data('world');
            const $entries = $(spine).next('.rpg-lb-lore-entries');
            const entryEls = $entries.find('.rpg-lb-entry');

            if (entryEls.length > 0) {
                const data = await lorebookAPI.loadWorldData(worldName);
                if (data) {
                    let entryOrder = entryEls.length;
                    for (const entryEl of entryEls) {
                        const uid = Number($(entryEl).data('uid'));
                        lorebookAPI.updateEntryField(data, uid, 'order', entryOrder * 10);
                        $(entryEl).find('input[data-field="order"]').val(entryOrder * 10);
                        entryOrder--;
                    }
                    await lorebookAPI.saveWorldData(worldName, data);
                }
            }
            order -= 10;
        }
    });

    $modal.on('click', '.rpg-lb-book-check', function (e) {
        e.stopPropagation();
        $(this).toggleClass('checked');

        const count = $modal.find('.rpg-lb-book-check.checked').length;
        $modal.find('.rpg-lb-bulk-count').text(`Selected: ${count}`);
    });

    $modal.on('click', '.rpg-lb-bulk-btn[data-action="select-all"]', function () {
        const checks = $modal.find('.rpg-lb-book-spine:visible .rpg-lb-book-check');
        const allChecked = checks.filter('.checked').length === checks.length;

        if (allChecked) {
            checks.removeClass('checked');
        } else {
            checks.addClass('checked');
        }

        const count = $modal.find('.rpg-lb-book-check.checked').length;
        $modal.find('.rpg-lb-bulk-count').text(`Selected: ${count}`);
    });

    $modal.on('click', '.rpg-lb-bulk-activate', async function () {
        const checked = $modal.find('.rpg-lb-book-check.checked');
        for (const el of checked) {
            const $spine = $(el).closest('.rpg-lb-book-spine');
            const worldName = $spine.data('world');
            await lorebookAPI.activateWorld(worldName);
            $spine.find('.rpg-lb-toggle[data-type="book"]').addClass('active');
            $spine.addClass('active-book').removeClass('inactive');
        }
        checked.removeClass('checked');
        $modal.find('.rpg-lb-bulk-count').text('Selected: 0');
        refreshActiveStats();
        refreshCampaignToggles();
    });

    $modal.on('click', '.rpg-lb-bulk-deactivate', async function () {
        const checked = $modal.find('.rpg-lb-book-check.checked');
        for (const el of checked) {
            const $spine = $(el).closest('.rpg-lb-book-spine');
            const worldName = $spine.data('world');
            await lorebookAPI.deactivateWorld(worldName);
            $spine.find('.rpg-lb-toggle[data-type="book"]').removeClass('active');
            $spine.removeClass('active-book').addClass('inactive');
        }
        checked.removeClass('checked');
        $modal.find('.rpg-lb-bulk-count').text('Selected: 0');
        refreshActiveStats();
        refreshCampaignToggles();
    });

    $modal.on('change', '.rpg-lb-entry-body input, .rpg-lb-entry-body select', async function () {
        await handleFieldChange($(this));
    });
    $modal.on('input', '.rpg-lb-entry-body textarea', async function () {
        const $el = $(this);
        const worldName = $el.data('world');
        const uid = Number($el.data('uid'));
        const field = $el.data('field');
        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;
        const value = parseFieldValue(field, $el.val(), $el);
        lorebookAPI.updateEntryField(data, uid, field, value);
        debouncedSave(worldName, data);
        if (field === 'content') {
            const tokEst = Math.round(($el.val()?.length || 0) / 3.5);
            $el.closest('.rpg-lb-form-section').find('.rpg-lb-token-count').html(
                `<i class="fa-solid fa-coins"></i> ~${tokEst} tokens`
            );
        }
    });
    $modal.on('click', '.rpg-lb-entry-order-inline input', function (e) {
        e.stopPropagation();
    });
    $modal.on('change', '.rpg-lb-entry-order-inline input', async function () {
        const $el = $(this);
        const worldName = $el.data('world');
        const uid = Number($el.data('uid'));
        const value = Number($el.val());
        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;
        lorebookAPI.updateEntryField(data, uid, 'order', value);
        await lorebookAPI.saveWorldData(worldName, data);
        const $entry = $el.closest('.rpg-lb-entry, .rpg-lb-entry-header').parent();
        $entry.find('.rpg-lb-entry-body input[data-field="order"]').val(value);
    });

$modal.off('click', '.rpg-lb-btn-add-entry').on('click', '.rpg-lb-btn-add-entry', async function (e) {
    e.preventDefault();
    e.stopPropagation();
    
    const worldName = $(this).data('world');
    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) return;

    const newEntry = lorebookAPI.createEntry(worldName, data);
    if (!newEntry) return;

    await lorebookAPI.saveWorldData(worldName, data);
    
    const $entries = $(this).closest('.rpg-lb-lore-entries');
    if ($entries.length) {
        await renderEntriesForBook(worldName, $entries[0], data);
    } else {
        await loadMiddlePanelEntries(worldName);
    }
});

    $modal.on('click', '.rpg-lb-spine-edit', function (e) {
        e.stopPropagation();
        const worldName = $(this).closest('.rpg-lb-book-spine').data('world');
        const selectEl = document.getElementById('world_info');
        if (selectEl) {
            $(selectEl).val(worldName).trigger('change');
        }
    });
}

async function handleFieldChange($el) {
    const worldName = $el.data('world');
    const uid = Number($el.data('uid'));
    const field = $el.data('field');

    if (!worldName || uid === undefined || !field) return;

    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) return;

    const value = parseFieldValue(field, $el.is(':checkbox') ? $el.prop('checked') : $el.val(), $el);
    lorebookAPI.updateEntryField(data, uid, field, value);

    if (field === 'position') {
        const $selected = $el.find('option:selected');
        const roleStr = $selected.data('role');
        if (roleStr !== '' && roleStr !== undefined) {
            lorebookAPI.updateEntryField(data, uid, 'role', Number(roleStr));
        }
        const $entry = $el.closest('.rpg-lb-entry');
        const $outletRow = $entry.find('.rpg-lb-outlet-row');
        if (Number(value) === 7) {
            $outletRow.slideDown(200);
        } else {
            $outletRow.slideUp(200);
        }
    }

    await lorebookAPI.saveWorldData(worldName, data);
}

function parseFieldValue(field, rawValue, $el) {
    if (field === 'key' || field === 'keysecondary') {
        return String(rawValue).split(',').map(s => s.trim()).filter(Boolean);
    }

    if (field === 'caseSensitive' || field === 'matchWholeWords' || field === 'useGroupScoring') {
        if (rawValue === 'null') return null;
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;
        return rawValue;
    }

    const numericFields = [
        'position', 'depth', 'role', 'selectiveLogic', 'order',
        'probability', 'scanDepth', 'groupWeight', 'sticky',
        'cooldown', 'delay', 'delayUntilRecursion',
    ];
    if (numericFields.includes(field)) {
        const num = Number(rawValue);
        return isNaN(num) ? undefined : num;
    }

    const boolFields = [
        'selective', 'constant', 'excludeRecursion', 'preventRecursion',
        'ignoreBudget', 'useProbability', 'groupOverride', 'disable',
    ];
    if (boolFields.includes(field)) {
        return $el.is(':checkbox') ? $el.prop('checked') : Boolean(rawValue);
    }

    return rawValue;
}