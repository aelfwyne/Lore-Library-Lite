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
        <div class="rpg-lb-modal-content">
            <div class="rpg-lb-modal-header">
                <h3><i class="fa-solid fa-book-bookmark"></i> Lore Library</h3>
                <div class="rpg-lb-spacer"></div>
                <div class="rpg-lb-toggle" data-type="master" title="Toggle all lorebooks globally"></div>
                <!-- ADDED: Lock Button -->
                <button type="button" class="rpg-lb-lock" title="Lock modal (prevent accidental close)"><i class="fa-solid fa-lock-open"></i></button>
                <button type="button" class="rpg-lb-close" id="rpg-lorebook-close">&times;</button>
            </div>
            <div class="rpg-lb-modal-body">
                <!-- Rendered dynamically by lorebookRender.js -->
            </div>
            <div class="rpg-lb-modal-footer">
                <!-- Rendered dynamically by lorebookRender.js -->
            </div>
        </div>
    </div>`;

    $('body').append(modalHTML);
}

function interceptNativeWIButton() {
    console.warn("[Lore Library] Binding capture-phase interceptor to click events.");
    
    document.addEventListener('click', function (e) {
        // DIAGNOSTIC NUKE: Log EVERY single click during capture phase
        console.warn("[Lore Library] RAW CLICK DETECTED. Target element:", e.target);
        console.warn("[Lore Library] Target ID:", e.target.id, " | Target Classes:", e.target.className);

        // Broadened the net to catch standard title attributes as well
        const target = e.target.closest('#world_info_button, .world_info_button, [title="World Info"], [title="World info"]');
        
        if (target) {
            console.warn(`[Lore Library] CLICK INTERCEPTED on World Info button!`);
            
            const settings = getSettings();
            if (settings.enabled && settings.lorebook.enabled) {
                console.warn("[Lore Library] Settings check passed. Hijacking click.");
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                try {
                    openLorebookModal();
                    console.warn("[Lore Library] Modal opened successfully.");
                } catch (err) {
                    console.error("[Lore Library] CRASH inside openLorebookModal:", err);
                }
            } else {
                console.warn("[Lore Library] Settings indicate extension is disabled. Letting native UI handle click.");
            }
        }
    }, true); 
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