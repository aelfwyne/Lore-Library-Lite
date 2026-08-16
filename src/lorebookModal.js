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

import { getSettings } from '../index.js';
import { renderLorebook, resetLorebookViewState } from './lorebookRender.js';
import { clearWICache } from './lorebookAPI.js';

export class LorebookModal {
    constructor() {
        this.modal = document.getElementById('rpg-lorebook-modal');
        this.content = this.modal?.querySelector('.rpg-lb-modal-content');
        this.isAnimating = false;
        this._isOpen = false;
    }

	open() {
        if (this.isAnimating || !this.modal) return;

        const settings = getSettings();
        const theme = settings.theme || 'default';
        this.modal.setAttribute('data-theme', theme);

        if (theme === 'custom') {
            this._applyCustomTheme();
        }

        // Brute-force inline styles to bypass CSS cache/loading issues and guarantee visibility
        this.modal.style.display = 'flex';
        this.modal.style.zIndex = '199999';

        this.modal.classList.add('is-open');
        this.modal.classList.remove('is-closing');
        this._isOpen = true;

        document.body.style.overflow = 'hidden';

        this.modal.querySelector('.rpg-lb-close')?.focus();

        clearWICache();
        resetLorebookViewState();
        renderLorebook();
    }
	
    close() {
        if (this.isAnimating || !this.modal) return;

        this.isAnimating = true;
        this._isOpen = false;
        this.modal.classList.add('is-closing');
        this.modal.classList.remove('is-open');

        document.body.style.overflow = '';

        setTimeout(() => {
            this.modal.classList.remove('is-closing');
            this.modal.style.display = 'none'; // Force hide inline
            this.isAnimating = false;
        }, 200);
    }

    isOpen() {
        return this._isOpen;
    }

    updateTheme() {
        if (!this.modal) return;
        const settings = getSettings();
        const theme = settings.theme || 'default';
        this.modal.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            this._applyCustomTheme();
        } else {
            this._clearCustomTheme();
        }
    }

    _applyCustomTheme() {
        const settings = getSettings();
        if (!this.content || !settings.customColors) return;
        this.content.style.setProperty('--rpg-bg', settings.customColors.bg);
        this.content.style.setProperty('--rpg-accent', settings.customColors.accent);
        this.content.style.setProperty('--rpg-text', settings.customColors.text);
        this.content.style.setProperty('--rpg-highlight', settings.customColors.highlight);
    }

    _clearCustomTheme() {
        if (!this.content) return;
        this.content.style.setProperty('--rpg-bg', '');
        this.content.style.setProperty('--rpg-accent', '');
        this.content.style.setProperty('--rpg-text', '');
        this.content.style.setProperty('--rpg-highlight', '');
    }
}

let lorebookModal = null;

export function setupLorebookModal() {
    lorebookModal = new LorebookModal();
}

export function getLorebookModal() {
    return lorebookModal;
}

export function openLorebookModal() {
    if (!lorebookModal) setupLorebookModal();
    lorebookModal.open();
}