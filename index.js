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

import { saveSettingsDebounced } from '/script.js';
import { getContext } from '/scripts/extensions.js';
import { setupLorebookModal, openLorebookModal } from './src/lorebookModal.js';
import { initLorebookEventDelegation } from './src/lorebookRender.js';

const EXTENSION_NAME = 'lore-library';

const defaultSettings = {
    enabled: true,
    theme: 'default',
    lorebook: {
        enabled: true,
        campaigns: {},
        campaignOrder: [],
        collapsedCampaigns: [],
        expandedBooks: [],
        lastActiveTab: 'all',
        lastFilter: 'all',
        lastSearch: ''
    }
};

export function getSettings() {
    const context = getContext();
    const extSettings = context.extension_settings || context.extensionSettings || {};
    
    if (!extSettings[EXTENSION_NAME]) {
        extSettings[EXTENSION_NAME] = JSON.parse(JSON.stringify(defaultSettings));
    }
    return extSettings[EXTENSION_NAME];
}

export function saveSettings() {
    saveSettingsDebounced();
}

function injectModalHTML() {
    if ($('#rpg-lorebook-modal').length) {
        console.warn("[Lore Library] Modal HTML already exists, skipping injection.");
        return;
    }

    console.warn("[Lore Library] Injecting Modal HTML into DOM.");
    const modalHTML = `
    <div id="rpg-lorebook-modal" class="rpg-lb-modal" style="display: none;">
        <!-- Existing modal content remains untouched -->
        <div class="rpg-lb-modal-content">
			<div class="rpg-lb-modal-header">
                <h3><i class="fa-solid fa-book-bookmark"></i> Lore Library</h3>
                <div class="rpg-lb-spacer"></div>
                <div class="rpg-lb-toggle" data-type="master" title="Master Toggle (Global): Toggle all lorebooks globally across ALL chats and characters."></div>
                <button type="button" class="rpg-lb-fullscreen" title="Toggle fullscreen view"><i class="fa-solid fa-maximize"></i></button>
                <button type="button" class="rpg-lb-lock" title="Lock modal (prevent accidental close)"><i class="fa-solid fa-lock-open"></i></button>
                <button type="button" class="rpg-lb-close" id="rpg-lorebook-close">&times;</button>
            </div>
            <div class="rpg-lb-modal-body"></div>
            <div class="rpg-lb-modal-footer"></div>
        </div>
    </div>`;

    // NEW: Inject the pop-out modal template
    const popoutHTML = `
    <div id="rpg-lb-popout-modal" class="rpg-lb-modal" style="display: none; z-index: 200005;">
        <div class="rpg-lb-modal-content" style="width: 85vw; max-width: 1400px; height: 85vh; max-height: 1000px;">
            <div class="rpg-lb-modal-header">
                <h3><i class="fa-solid fa-up-right-from-square"></i> Expanded Editor</h3>
                <div class="rpg-lb-spacer"></div>
                <button type="button" class="rpg-lb-close" id="rpg-lb-popout-close" title="Close window">&times;</button>
            </div>
            <div class="rpg-lb-modal-body" style="padding: 16px; display: flex; flex-direction: column; flex: 1;">
                <textarea id="rpg-lb-popout-textarea" class="rpg-lb-textarea" style="flex: 1; resize: none; font-size: 1.05em; padding: 16px; line-height: 1.5; font-family: monospace;"></textarea>
            </div>
            <div class="rpg-lb-modal-footer" style="justify-content: flex-end; gap: 12px; padding: 12px 16px;">
                <button id="rpg-lb-popout-discard" class="rpg-lb-btn-import" style="width: auto;"><i class="fa-solid fa-trash-can"></i> Discard Changes</button>
                <button id="rpg-lb-popout-save" class="rpg-lb-btn-new-book" style="width: auto; background: rgba(46, 204, 113, 0.2); border-color: #2ecc71; color: #fff;"><i class="fa-solid fa-floppy-disk"></i> Save & Close</button>
            </div>
        </div>
    </div>`;

    $('body').append(modalHTML);
    $('body').append(popoutHTML);
}

function interceptNativeWIButton() {
    console.warn("[Lore Library] Binding capture-phase interceptor to click and touch events.");
    
    const triggerHandler = function (e) {
        // Expand the selector to capture mobile drawer buttons, nav items, and localized data-i18n attributes in ST mobile UI
        const target = e.target.closest([
            '#world_info_button',
            '#rm_button_world_info',
            '#nav-world-info',
            '#option_world_info',
            '.world_info_button',
            '[title*="World Info" i]',
            '[title*="World info" i]',
            '[data-i18n*="World Info" i]',
            '[data-i18n*="World info" i]',
            '[aria-label*="World Info" i]'
        ].join(', '));
        
        if (target) {
            console.warn("[Lore Library] Click/Touch intercepted on World Info button:", target);
            
            const settings = getSettings();
            if (settings.enabled && settings.lorebook.enabled) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                try {
                    openLorebookModal();
                    console.warn("[Lore Library] Modal opened successfully.");
                } catch (err) {
                    console.error("[Lore Library] CRASH inside openLorebookModal:", err);
                }
            }
        }
    };

    // Listen on document during capture phase for click events
    document.addEventListener('click', triggerHandler, true);
}


$(document).ready(() => {
    console.warn("[Lore Library] STEP 3: DOCUMENT READY fired. Booting up extension...");
    
    try {
        getSettings();
        console.warn("[Lore Library] Settings initialized.");
        
        injectModalHTML();
        console.warn("[Lore Library] Modal HTML initialized.");
        
        setupLorebookModal();
        console.warn("[Lore Library] Modal lifecycle manager initialized.");
        
        initLorebookEventDelegation(); 
        console.warn("[Lore Library] UI event delegation initialized.");
        
        interceptNativeWIButton();
        console.warn("[Lore Library] STEP 4: Boot sequence complete.");
    } catch (err) {
        console.error("[Lore Library] FATAL CRASH DURING BOOT:", err);
    }
});