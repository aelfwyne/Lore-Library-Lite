/**
 * Campaign Manager
 * Handles CRUD operations for lorebook campaigns (folders/groups).
 */
import { getSettings, saveSettings } from '../index.js';
import { getAllWorldNames } from './lorebookAPI.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generates a simple UUID for campaign IDs
 * @returns {string}
 */
function generateId() {
    return 'campaign_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

/**
 * Ensures lorebook settings are initialized
 */
function ensureLorebook() {
    const settings = getSettings();
    if (!settings.lorebook) {
        settings.lorebook = {
            enabled: true,
            campaigns: {},
            campaignOrder: [],
            collapsedCampaigns: [],
            expandedBooks: [],
            lastActiveTab: 'all',
            lastFilter: 'all',
            lastSearch: ''
        };
    }
    if (!settings.lorebook.campaigns) {
        settings.lorebook.campaigns = {};
    }
    if (!settings.lorebook.campaignOrder) {
        settings.lorebook.campaignOrder = [];
    }
}

// ─── Campaign CRUD ──────────────────────────────────────────────────────────

/**
 * Creates a new campaign
 * @param {string} name - Campaign display name
 * @param {string} [icon='fa-folder'] - Campaign icon
 * @param {string} [color=''] - Optional accent color hex
 * @returns {string} The new campaign ID
 */
export function createCampaign(name, icon = 'fa-folder', color = '') {
    ensureLorebook();
    const settings = getSettings();
    const id = generateId();
    settings.lorebook.campaigns[id] = {
        id,
        name,
        icon,
        color,
        books: []
    };
    settings.lorebook.campaignOrder.push(id);
    saveSettings();
    return id;
}

/**
 * Deletes a campaign. Books inside become unfiled.
 * @param {string} id - Campaign ID to delete
 * @returns {boolean} True if deleted
 */
export function deleteCampaign(id) {
    ensureLorebook();
    const settings = getSettings();
    if (!settings.lorebook.campaigns[id]) return false;

    delete settings.lorebook.campaigns[id];

    // Remove from order array
    const orderIdx = settings.lorebook.campaignOrder.indexOf(id);
    if (orderIdx !== -1) {
        settings.lorebook.campaignOrder.splice(orderIdx, 1);
    }

    // Remove from collapsed list
    const collIdx = (settings.lorebook.collapsedCampaigns || []).indexOf(id);
    if (collIdx !== -1) {
        settings.lorebook.collapsedCampaigns.splice(collIdx, 1);
    }

    saveSettings();
    return true;
}

/**
 * Renames a campaign
 * @param {string} id - Campaign ID
 * @param {string} newName - New display name
 */
export function renameCampaign(id, newName) {
    ensureLorebook();
    const settings = getSettings();
    const campaign = settings.lorebook.campaigns[id];
    if (campaign) {
        campaign.name = newName;
        saveSettings();
    }
}

/**
 * Updates a campaign's icon
 * @param {string} id - Campaign ID
 * @param {string} icon - New icon/emoji
 */
export function updateCampaignIcon(id, icon) {
    ensureLorebook();
    const settings = getSettings();
    const campaign = settings.lorebook.campaigns[id];
    if (campaign) {
        campaign.icon = icon;
        saveSettings();
    }
}

/**
 * Updates a campaign's color
 * @param {string} id - Campaign ID
 * @param {string} color - New color hex string
 */
export function updateCampaignColor(id, color) {
    ensureLorebook();
    const settings = getSettings();
    const campaign = settings.lorebook.campaigns[id];
    if (campaign) {
        campaign.color = color;
        saveSettings();
    }
}

// ─── Book Assignment ────────────────────────────────────────────────────────

/**
 * Adds a WI file to a campaign. If it's already in another campaign, removes it first.
 * @param {string} campaignId - Target campaign ID
 * @param {string} worldName - WI filename to assign
 */
export function addBookToCampaign(campaignId, worldName) {
    ensureLorebook();
    const settings = getSettings();

    // Remove from any existing campaign first
    for (const campaign of Object.values(settings.lorebook.campaigns)) {
        const idx = campaign.books.indexOf(worldName);
        if (idx !== -1) {
            campaign.books.splice(idx, 1);
        }
    }

    // Add to target campaign
    const target = settings.lorebook.campaigns[campaignId];
    if (target) {
        if (!target.books.includes(worldName)) {
            target.books.push(worldName);
        }
        saveSettings();
    }
}

/**
 * Removes a WI file from a campaign (book becomes unfiled)
 * @param {string} campaignId - Campaign ID
 * @param {string} worldName - WI filename to remove
 */
export function removeBookFromCampaign(campaignId, worldName) {
    ensureLorebook();
    const settings = getSettings();
    const campaign = settings.lorebook.campaigns[campaignId];
    if (campaign) {
        const idx = campaign.books.indexOf(worldName);
        if (idx !== -1) {
            campaign.books.splice(idx, 1);
            saveSettings();
        }
    }
}

/**
 * Moves a book between campaigns
 * @param {string} fromId - Source campaign ID (or null for unfiled)
 * @param {string} toId - Target campaign ID
 * @param {string} worldName - WI filename
 */
export function moveBookBetweenCampaigns(fromId, toId, worldName) {
    ensureLorebook();
    if (fromId) {
        removeBookFromCampaign(fromId, worldName);
    }
    addBookToCampaign(toId, worldName);
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Returns all lorebooks not assigned to any campaign
 * @returns {string[]} Array of unfiled WI filenames
 */
export function getUnfiledBooks() {
    ensureLorebook();
    const settings = getSettings();
    const allNames = getAllWorldNames();
    const assignedSet = new Set();
    for (const campaign of Object.values(settings.lorebook.campaigns)) {
        for (const book of campaign.books) {
            assignedSet.add(book);
        }
    }
    return allNames.filter(name => !assignedSet.has(name));
}

/**
 * Finds which campaign contains a given book
 * @param {string} worldName - WI filename
 * @returns {{id: string, campaign: Object}|null} Campaign info or null if unfiled
 */
export function getCampaignForBook(worldName) {
    ensureLorebook();
    const settings = getSettings();
    for (const [id, campaign] of Object.entries(settings.lorebook.campaigns)) {
        if (campaign.books.includes(worldName)) {
            return { id, campaign };
        }
    }
    return null;
}

/**
 * Returns campaigns in display order
 * @returns {Array<{id: string, campaign: Object}>}
 */
export function getCampaignsInOrder() {
    ensureLorebook();
    const settings = getSettings();
    const campaigns = settings.lorebook.campaigns;
    const order = settings.lorebook.campaignOrder || [];

    // Start with ordered campaigns
    const result = [];
    for (const id of order) {
        if (campaigns[id]) {
            result.push({ id, campaign: campaigns[id] });
        }
    }

    // Add any campaigns not in the order array
    for (const [id, campaign] of Object.entries(campaigns)) {
        if (!order.includes(id)) {
            result.push({ id, campaign });
        }
    }

    return result;
}

/**
 * Updates the campaign display order
 * @param {string[]} newOrder - Array of campaign IDs in desired order
 */
export function reorderCampaigns(newOrder) {
    ensureLorebook();
    const settings = getSettings();
    settings.lorebook.campaignOrder = newOrder;
    saveSettings();
}

// ─── UI State ───────────────────────────────────────────────────────────────

/**
 * Checks if a campaign is collapsed in the UI
 * @param {string} id - Campaign ID
 * @returns {boolean}
 */
export function isCampaignCollapsed(id) {
    const settings = getSettings();
    return (settings.lorebook?.collapsedCampaigns || []).includes(id);
}

/**
 * Toggles a campaign's collapsed state
 * @param {string} id - Campaign ID
 */
export function toggleCampaignCollapsed(id) {
    ensureLorebook();
    const settings = getSettings();
    if (!settings.lorebook.collapsedCampaigns) {
        settings.lorebook.collapsedCampaigns = [];
    }
    const idx = settings.lorebook.collapsedCampaigns.indexOf(id);
    if (idx !== -1) {
        settings.lorebook.collapsedCampaigns.splice(idx, 1);
    } else {
        settings.lorebook.collapsedCampaigns.push(id);
    }
    saveSettings();
}

/**
 * Checks if a book spine is expanded in the UI
 * @param {string} worldName - WI filename
 * @returns {boolean}
 */
export function isBookExpanded(worldName) {
    const settings = getSettings();
    return (settings.lorebook?.expandedBooks || []).includes(worldName);
}

/**
 * Toggles a book spine's expanded state
 * @param {string} worldName - WI filename
 */
export function toggleBookExpanded(worldName) {
    ensureLorebook();
    const settings = getSettings();
    if (!settings.lorebook.expandedBooks) {
        settings.lorebook.expandedBooks = [];
    }
    const idx = settings.lorebook.expandedBooks.indexOf(worldName);
    if (idx !== -1) {
        settings.lorebook.expandedBooks.splice(idx, 1);
    } else {
        settings.lorebook.expandedBooks.push(worldName);
    }
    saveSettings();
}

/**
 * Sets the last active tab
 * @param {string} tab - Tab identifier
 */
export function setLastActiveTab(tab) {
    ensureLorebook();
    const settings = getSettings();
    settings.lorebook.lastActiveTab = tab;
    saveSettings();
}

/**
 * Sets the last filter
 * @param {string} filter - Filter value ('all', 'active', 'inactive')
 */
export function setLastFilter(filter) {
    ensureLorebook();
    const settings = getSettings();
    settings.lorebook.lastFilter = filter;
    saveSettings();
}

/**
 * Sets the last search query
 * @param {string} search - Search string
 */
export function setLastSearch(search) {
    ensureLorebook();
    const settings = getSettings();
    settings.lorebook.lastSearch = search;
}