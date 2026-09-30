/*
 * Modifications and standalone adaptation Copyright (c) [2026] [aelfwyne @ github].
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
 * See the LICENSE file in the project root for full terms.
 */

/**
 * XML Form Editor
 * ────────────────────────────────────────────────────────────────────────
 * A self-contained companion to the Pop-out Editor. Given the raw text of
 * a lore entry's "Content" field, it parses any XML-style tags found in
 * it and renders an editable form built from that structure — one field
 * per tag, nested tags become nested groups, attributes become their own
 * small inputs. Saving re-serializes the (edited) XML and writes it back
 * into the source textarea, exactly like the Pop-out Editor does.
 *
 * If the content isn't well-formed XML, the editor refuses to build a
 * form and instead reports where the parser choked.
 *
 * This file deliberately owns its own DOM (it injects its own modal on
 * first use), its own state, and its own styling hooks. It only reads a
 * <textarea> element that's handed to it and only ever writes back to
 * that same element — it does not import or depend on lorebookAPI,
 * campaignManager, or any settings/persistence code elsewhere in the
 * project.
 */

import { escapeHtml } from './utils.js';

const MODAL_ID = 'rpg-lb-xmlform-modal';
// A synthetic root tag used only to make arbitrary "XML-ish" content
// (which may have multiple top-level tags and/or loose text) parseable
// as a single well-formed document. It is stripped back out on save and
// never shown to the user.
const WRAPPER_TAG = 'rpglbxmlformroot';

let modalReady = false;

/** @type {{ sourceTextarea: HTMLTextAreaElement|null, wrapperEl: Element|null, originalSerialized: string|null }} */
let state = {
    sourceTextarea: null,
    wrapperEl: null,
    originalSerialized: null,
};

// ─── Modal shell (injected lazily, isolated from index.js) ─────────────────

function ensureModal() {
    if (modalReady) return;

    const html = `
    <div id="${MODAL_ID}" class="rpg-lb-modal" style="display:none; z-index: 200010;">
        <div class="rpg-lb-modal-content rpg-lb-xmlform-content">
            <div class="rpg-lb-modal-header">
                <h3><i class="fa-solid fa-code"></i> XML Form Editor</h3>
                <div class="rpg-lb-spacer"></div>
                <button type="button" class="rpg-lb-close" id="rpg-lb-xmlform-close" title="Close">&times;</button>
            </div>
            <div class="rpg-lb-modal-body rpg-lb-xmlform-body">
                <div class="rpg-lb-xmlform-fields"></div>
            </div>
            <div class="rpg-lb-modal-footer rpg-lb-xmlform-footer">
                <span class="rpg-lb-xmlform-hint"><i class="fa-solid fa-circle-info"></i> Edits apply to the Content field only after you save.</span>
                <div class="rpg-lb-footer-right">
                    <button type="button" id="rpg-lb-xmlform-cancel" class="rpg-lb-btn-import" style="width:auto;"><i class="fa-solid fa-xmark"></i> Cancel</button>
                    <button type="button" id="rpg-lb-xmlform-save" class="rpg-lb-btn-new-book" style="width:auto; background: rgba(46, 204, 113, 0.2); border-color: #2ecc71; color: #fff;"><i class="fa-solid fa-floppy-disk"></i> Save & Close</button>
                </div>
            </div>
        </div>
    </div>`;

    $('body').append(html);

    $(`#rpg-lb-xmlform-close, #rpg-lb-xmlform-cancel`).on('click', () => closeXmlFormEditor(false));
    $('#rpg-lb-xmlform-save').on('click', () => saveAndClose());

    // Intentionally no click-outside-to-close: this dialog can hold
    // meaningful edits, so it should only close via an explicit action
    // (Save, Cancel, the × button, or Escape).

    modalReady = true;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Opens the XML Form Editor for a given content textarea.
 * @param {HTMLTextAreaElement} sourceTextareaEl - The entry's "Content" textarea.
 */
export function openXmlFormEditor(sourceTextareaEl) {
    ensureModal();
    const $modal = $(`#${MODAL_ID}`);
    const rawText = sourceTextareaEl ? (sourceTextareaEl.value ?? '') : '';

    state.sourceTextarea = sourceTextareaEl || null;
    state.wrapperEl = null;
    state.originalSerialized = null;

    $modal.css('display', 'flex');

    let parsed;
    try {
        parsed = parseXmlContent(rawText);
    } catch (err) {
        renderError(err);
        setSaveEnabled(false);
        return;
    }

    state.wrapperEl = parsed.wrapperEl;
    state.originalSerialized = serializeWrapper(state.wrapperEl);

    setSaveEnabled(true);
    buildForm(state.wrapperEl);
}

/**
 * Whether the XML Form Editor is currently open. Useful for callers that
 * need to make sure Escape/other global shortcuts close this dialog
 * first instead of the lorebook modal underneath it.
 * @returns {boolean}
 */
export function isXmlFormEditorOpen() {
    const el = document.getElementById(MODAL_ID);
    return !!el && el.style.display !== 'none' && el.style.display !== '';
}

/**
 * Closes the editor, prompting to save first if there are unsaved edits.
 * Safe to call even if the editor isn't open.
 */
export function closeXmlFormEditor(skipUnsavedCheck) {
    const el = document.getElementById(MODAL_ID);
    if (!el || !isXmlFormEditorOpen()) return;

    if (!skipUnsavedCheck && state.wrapperEl) {
        const current = serializeWrapper(state.wrapperEl);
        if (current !== state.originalSerialized) {
            const wantsSave = confirm(
                'You have unsaved changes in the XML Form Editor.\n\n' +
                'Click OK to save them to the Content field.\n' +
                'Click Cancel to discard them and close.',
            );
            if (wantsSave) {
                saveAndClose();
                return;
            }
        }
    }

    $(el).css('display', 'none');
    state = { sourceTextarea: null, wrapperEl: null, originalSerialized: null };
}

// ─── Save ───────────────────────────────────────────────────────────────────

function saveAndClose() {
    if (!state.wrapperEl) {
        closeXmlFormEditor(true);
        return;
    }

    const newText = serializeWrapper(state.wrapperEl);
    if (state.sourceTextarea) {
        // Mirrors the Pop-out Editor's save behavior: write the value back
        // into the real textarea and fire 'input' so the existing content
        // handler (autosave, token count, etc.) picks it up.
        $(state.sourceTextarea).val(newText).trigger('input');
    }

    closeXmlFormEditor(true);
}

function setSaveEnabled(enabled) {
    $('#rpg-lb-xmlform-save').prop('disabled', !enabled).css({
        opacity: enabled ? '' : 0.4,
        cursor: enabled ? '' : 'not-allowed',
    });
}

// ─── XML parsing ────────────────────────────────────────────────────────────

/**
 * Parses raw entry text as XML, wrapping it in a synthetic root so that
 * multiple top-level tags (or loose text alongside tags) are permitted.
 * Throws a descriptive Error (with .snippet / .rawMessage / .line /
 * .column when available) if the content is not well-formed.
 */
function parseXmlContent(rawText) {
    const text = (rawText ?? '').toString();

    if (!text.trim()) {
        const err = new Error('This entry has no content to build a form from.');
        err.isEmpty = true;
        throw err;
    }

    const wrapped = `<${WRAPPER_TAG}>${text}</${WRAPPER_TAG}>`;
    const doc = new DOMParser().parseFromString(wrapped, 'application/xml');

    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
        throw buildParseError(errorNode.textContent || 'Unknown XML parsing error.', text);
    }

    return { wrapperEl: doc.documentElement };
}

/**
 * Turns a browser parsererror message into a friendlier, located error.
 * Browsers vary in exact wording, so this is best-effort: it looks for
 * "line N" / "column N" in the message and shows the offending source
 * line with a caret under the reported column.
 */
function buildParseError(rawMessage, originalText) {
    const lineMatch = rawMessage.match(/line[\s:]*?(\d+)/i);
    const colMatch = rawMessage.match(/column[\s:]*?(\d+)/i);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : null;
    let col = colMatch ? parseInt(colMatch[1], 10) : null;

    let snippet = '';
    if (line != null) {
        // Line 1 of the parsed document is line 1 of the original text
        // shifted right by the length of the synthetic wrapper tag we
        // prepended (since we didn't add a newline before the content).
        if (line === 1 && col != null) {
            col = Math.max(1, col - `<${WRAPPER_TAG}>`.length);
        }
        const lines = originalText.split('\n');
        const idx = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
        const lineText = lines[idx] ?? '';
        const caretPos = col != null ? Math.max(0, Math.min(col - 1, lineText.length)) : 0;
        snippet = `${lineText}\n${' '.repeat(caretPos)}^`;
    }

    const err = new Error(
        line != null
            ? `Invalid XML near line ${line}${col != null ? `, column ${col}` : ''}.`
            : "Invalid XML — the parser couldn't read this content.",
    );
    err.isParseError = true;
    err.rawMessage = rawMessage;
    err.snippet = snippet;
    return err;
}

// ─── XML serialization ──────────────────────────────────────────────────────

/**
 * Serializes the children of the synthetic wrapper root back into a plain
 * string — i.e. the wrapper tag itself is never included in the output.
 */
function serializeWrapper(wrapperEl) {
    const serializer = new XMLSerializer();
    let out = '';
    for (const node of Array.from(wrapperEl.childNodes)) {
        out += serializer.serializeToString(node);
    }
    return out;
}

// ─── Form rendering ─────────────────────────────────────────────────────────

function renderError(err) {
    const $fields = $(`#${MODAL_ID} .rpg-lb-xmlform-fields`).empty();

    const box = document.createElement('div');
    box.className = 'rpg-lb-xmlform-error';

    const title = document.createElement('div');
    title.className = 'rpg-lb-xmlform-error-title';
    title.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}`;
    box.appendChild(title);

    if (err.snippet) {
        const pre = document.createElement('pre');
        pre.className = 'rpg-lb-xmlform-error-snippet';
        pre.textContent = err.snippet;
        box.appendChild(pre);
    }

    if (err.rawMessage) {
        const details = document.createElement('details');
        details.className = 'rpg-lb-xmlform-error-details';
        const summary = document.createElement('summary');
        summary.textContent = 'Full parser message';
        const pre = document.createElement('pre');
        pre.textContent = err.rawMessage;
        details.appendChild(summary);
        details.appendChild(pre);
        box.appendChild(details);
    }

    const hint = document.createElement('p');
    hint.className = 'rpg-lb-xmlform-error-hint';
    hint.textContent = err.isEmpty
        ? 'Add some XML-style tags in the Pop-out Editor first, then reopen this form.'
        : 'Fix the issue in the Pop-out Editor, then reopen this form. Common causes: an unclosed tag, a mismatched closing tag name, or a stray "<" or "&" that needs escaping.';
    box.appendChild(hint);

    $fields.append(box);
}

function buildForm(wrapperEl) {
    const $fields = $(`#${MODAL_ID} .rpg-lb-xmlform-fields`).empty();
    $fields.append(renderChildren(wrapperEl));
}

function renderChildren(parentNode) {
    const wrap = document.createElement('div');
    wrap.className = 'rpg-lb-xmlform-group';

    let hasAny = false;
    for (const node of Array.from(parentNode.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            hasAny = true;
            wrap.appendChild(renderElementField(node));
        } else if (
            (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) &&
            node.nodeValue &&
            node.nodeValue.trim()
        ) {
            hasAny = true;
            wrap.appendChild(renderTextNodeField(node));
        }
    }

    if (!hasAny) {
        const empty = document.createElement('div');
        empty.className = 'rpg-lb-xmlform-empty';
        empty.textContent = '(empty)';
        wrap.appendChild(empty);
    }

    return wrap;
}

function elementHasChildElements(el) {
    return Array.from(el.childNodes).some((n) => n.nodeType === Node.ELEMENT_NODE);
}

function renderElementField(el) {
    const field = document.createElement('div');
    field.className = 'rpg-lb-xmlform-field';

    const header = document.createElement('div');
    header.className = 'rpg-lb-xmlform-field-header';
    header.innerHTML = `<span class="rpg-lb-xmlform-tag-label"><i class="fa-solid fa-code"></i> &lt;${escapeHtml(el.tagName)}&gt;</span>`;
    field.appendChild(header);

    if (el.attributes && el.attributes.length) {
        const attrRow = document.createElement('div');
        attrRow.className = 'rpg-lb-xmlform-attr-row';
        for (const attr of Array.from(el.attributes)) {
            attrRow.appendChild(renderAttributeField(el, attr));
        }
        field.appendChild(attrRow);
    }

    if (elementHasChildElements(el)) {
        const nested = renderChildren(el);
        nested.classList.add('rpg-lb-xmlform-nested');
        field.appendChild(nested);
    } else {
        field.appendChild(renderLeafTextarea(el.textContent, (val) => {
            el.textContent = val;
        }));
    }

    return field;
}

function renderAttributeField(el, attr) {
    const label = document.createElement('label');
    label.className = 'rpg-lb-xmlform-attr';

    const name = document.createElement('span');
    name.className = 'rpg-lb-xmlform-attr-name';
    name.textContent = attr.name;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rpg-lb-input';
    input.value = attr.value;
    input.addEventListener('input', () => {
        el.setAttribute(attr.name, input.value);
    });

    label.appendChild(name);
    label.appendChild(input);
    return label;
}

function renderTextNodeField(node) {
    const field = document.createElement('div');
    field.className = 'rpg-lb-xmlform-field rpg-lb-xmlform-loosetext';

    const header = document.createElement('div');
    header.className = 'rpg-lb-xmlform-field-header';
    header.innerHTML = `<span class="rpg-lb-xmlform-tag-label"><i class="fa-solid fa-align-left"></i> Free text</span>`;
    field.appendChild(header);

    field.appendChild(renderLeafTextarea(node.nodeValue, (val) => {
        node.nodeValue = val;
    }));

    return field;
}

function renderLeafTextarea(initialValue, onChange) {
    const textarea = document.createElement('textarea');
    textarea.className = 'rpg-lb-textarea rpg-lb-xmlform-textarea';
    textarea.rows = guessRows(initialValue);
    textarea.value = initialValue ?? '';
    textarea.addEventListener('input', () => onChange(textarea.value));
    return textarea;
}

function guessRows(text) {
    const value = text || '';
    const lineCount = value.split('\n').length;
    return Math.min(12, Math.max(2, Math.max(lineCount, Math.ceil(value.length / 60))));
}