/*
 * Modifications and standalone adaptation Copyright (c) [2026] [aelfwyne @ github].
 *
 * Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
 * See the LICENSE file in the project root for full terms.
 */

/**
 * Pop-out Editor Syntax Highlighting & Section Folding
 * ────────────────────────────────────────────────────────────────────────
 * A self-contained add-on for the existing Pop-out Editor (#rpg-lb-popout-
 * textarea, defined in index.js). The first time it's used it wraps the
 * textarea in its own overlay structure and layers a highlighted,
 * read-only <pre> behind it, plus a narrow gutter for collapsing
 * block-level tags.
 *
 * Detection is automatic and content-driven:
 *   - Looks like XML tags?           → XML tag/attribute highlighting.
 *   - Looks like "Key: value" lines? → key/value highlighting.
 *   - Neither?                       → plain textarea, untouched.
 *
 * The real <textarea> stays fully interactive but paints its text
 * transparent; the <pre> behind it renders the same text in color. For
 * the caret to line up, the two layers must wrap and advance glyphs
 * IDENTICALLY. The things that break that (and are handled here):
 *   - Bold/italic highlight spans changing glyph widths  (CSS: none used)
 *   - Font ligatures merging chars in one layer only     (disabled on both)
 *   - The textarea's scrollbar narrowing its text area   (mirrored as padding)
 *   - The backdrop lagging behind typed text              (re-rendered per frame)
 *   - Programmatic .val() changes with no 'input' event   (re-rendered explicitly)
 *   - tab-size / word-break / etc. differing              (copied from textarea)
 *
 * Folding works on the real text: collapsing a block replaces it with a
 * "<tag>…</tag>" placeholder line and stashes the original. Callers MUST
 * call expandAllPopoutFolds() before reading the value for saving or
 * dirty-checking.
 */

import { escapeHtml } from './utils.js';

const TEXTAREA_ID = 'rpg-lb-popout-textarea';
const WRAP_CLASS = 'rpg-lb-popout-highlight-wrap';
const BACKDROP_CLASS = 'rpg-lb-popout-highlight-backdrop';
const GUTTER_CLASS = 'rpg-lb-popout-fold-gutter';
const MEASURER_CLASS = 'rpg-lb-popout-highlight-measure';
const ACTIVE_CLASS = 'rpg-lb-popout-highlighted';
const FOLD_BTN_CLASS = 'rpg-lb-popout-fold-toggle';

const GUTTER_DEBOUNCE_MS = 150;

let overlayReady = false;
let textareaEl = null;
let $textarea = null;
let $wrap = null;
let $backdrop = null;
let codeEl = null;
let $gutter = null;
let measurerEl = null;

let highlightFrame = null;
let gutterTimer = null;
let lastRenderedText = null;
let lastFormat = 'plain';
let lastScrollbarWidth = -1;
let basePaddingRight = 0;
let resizeObserver = null;

/** @type {Map<string, string>} key -> original (pre-collapse) block text. */
const collapsedRegions = new Map();

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Call whenever the Pop-out Editor's value is (re)populated
 * programmatically (e.g. right after opening it). Safe to call repeatedly.
 */
export function refreshPopoutHighlight() {
    if (!ensureOverlay()) return;
    lastRenderedText = null;
    lastScrollbarWidth = -1;
    syncBackdropMetrics();
    applyHighlight();
}

/**
 * Restores every collapsed section to its real text and forgets fold
 * state. MUST be called before reading the value for save/dirty-check.
 */
export function expandAllPopoutFolds() {
    if (!textareaEl || collapsedRegions.size === 0) return;

    let text = textareaEl.value || '';
    let changed = true;
    while (changed) {
        changed = false;
        const regions = scanFoldRegions(text);
        for (const region of regions) {
            if (region.kind !== 'collapsed') continue;
            const original = collapsedRegions.get(region.key);
            if (original == null) continue;
            const lines = text.split('\n');
            lines.splice(region.line, 1, original);
            text = lines.join('\n');
            collapsedRegions.delete(region.key);
            changed = true;
            break; // indices shifted; rescan
        }
    }
    collapsedRegions.clear();
    setValuePreservingView(text);
    // .val() fires no 'input' event, so re-render explicitly. Without this,
    // e.g. "Discard → Cancel" left the editor open with a stale backdrop
    // and a caret that no longer matched the visible text.
    applyHighlight();
}

// ─── Overlay setup (runs once) ──────────────────────────────────────────────

function ensureOverlay() {
    if (overlayReady && document.body.contains(textareaEl)) return true;

    textareaEl = document.getElementById(TEXTAREA_ID);
    if (!textareaEl) return false;
    $textarea = $(textareaEl);

    if (!$textarea.parent().hasClass(WRAP_CLASS)) {
        $textarea.wrap(`<div class="${WRAP_CLASS}"></div>`);
        $textarea.before(`<pre class="${BACKDROP_CLASS}" aria-hidden="true"><code></code></pre>`);
        $textarea.after(`<div class="${GUTTER_CLASS}"></div>`);
    }

    $wrap = $textarea.parent();
    $backdrop = $wrap.find(`.${BACKDROP_CLASS}`);
    codeEl = $backdrop.find('code').get(0);
    $gutter = $wrap.find(`.${GUTTER_CLASS}`);

    $textarea.off('.rpgLbHighlight')
        .on('input.rpgLbHighlight', scheduleHighlight)
        .on('scroll.rpgLbHighlight', syncScroll);

    $gutter.off('click.rpgLbFold').on('click.rpgLbFold', `.${FOLD_BTN_CLASS}`, function () {
        // Re-scan the CURRENT text rather than trusting the last gutter
        // render — the gutter is debounced, so its line numbers can be
        // stale if the user typed just before clicking.
        const key = this.dataset.key;
        const region = scanFoldRegions(textareaEl.value || '').find((r) => r.key === key);
        if (region) toggleFold(region);
    });

    if (!measurerEl) {
        measurerEl = document.createElement('div');
        measurerEl.className = MEASURER_CLASS;
        measurerEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(measurerEl);
    }

    if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
            if (!textareaEl || !textareaEl.offsetParent) return;
            lastScrollbarWidth = -1;
            syncScrollbarWidth();
            if (lastFormat === 'xml') scheduleGutter();
        });
        resizeObserver.observe(textareaEl);
    }

    overlayReady = true;
    return true;
}

/**
 * Copies every metric that affects glyph advance or line wrapping from the
 * live textarea onto the backdrop, so both layers lay text out identically.
 */
function syncBackdropMetrics() {
    if (!textareaEl || !$backdrop) return;

    // Ligatures would merge e.g. "</" or "->" into one glyph in the textarea
    // but not in the backdrop (where spans split them), shifting everything
    // after them. Disable on both layers.
    textareaEl.style.fontVariantLigatures = 'none';

    const cs = getComputedStyle(textareaEl);
    basePaddingRight = parseFloat(cs.paddingRight) || 0;

    const bs = $backdrop.get(0).style;
    bs.paddingTop = cs.paddingTop;
    bs.paddingBottom = cs.paddingBottom;
    bs.paddingLeft = cs.paddingLeft;
    bs.borderTopWidth = cs.borderTopWidth;
    bs.borderRightWidth = cs.borderRightWidth;
    bs.borderBottomWidth = cs.borderBottomWidth;
    bs.borderLeftWidth = cs.borderLeftWidth;
    bs.fontFamily = cs.fontFamily;
    bs.fontSize = cs.fontSize;
    bs.fontWeight = cs.fontWeight;
    bs.fontStyle = cs.fontStyle;
    bs.fontStretch = cs.fontStretch;
    bs.fontKerning = cs.fontKerning;
    bs.fontFeatureSettings = cs.fontFeatureSettings;
    bs.fontVariantLigatures = 'none';
    bs.lineHeight = cs.lineHeight;
    bs.letterSpacing = cs.letterSpacing;
    bs.wordSpacing = cs.wordSpacing;
    bs.textTransform = cs.textTransform;
    bs.textIndent = cs.textIndent;
    bs.textRendering = cs.textRendering;
    bs.tabSize = cs.tabSize;
    bs.wordBreak = cs.wordBreak;
    bs.overflowWrap = cs.overflowWrap;

    syncScrollbarWidth();
}

/**
 * When the textarea overflows, its vertical scrollbar eats into the text
 * width, so it wraps long lines EARLIER than the scrollbar-less backdrop.
 * Every soft-wrapped line after that point then shows text in a different
 * place than the caret. This mirrors the scrollbar width as extra right
 * padding on the backdrop. Cheap; called after every render.
 */
function syncScrollbarWidth() {
    if (!textareaEl || !$backdrop) return;
    const cs = getComputedStyle(textareaEl);
    const borders = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const sbw = Math.max(0, textareaEl.offsetWidth - textareaEl.clientWidth - borders);
    if (sbw === lastScrollbarWidth) return;
    lastScrollbarWidth = sbw;
    $backdrop.get(0).style.paddingRight = `${basePaddingRight + sbw}px`;
}

function syncScroll() {
    if (!$backdrop || !textareaEl) return;
    const bd = $backdrop.get(0);
    bd.scrollTop = textareaEl.scrollTop;
    bd.scrollLeft = textareaEl.scrollLeft;
    repositionFoldButtons();
}

function repositionFoldButtons() {
    if (!$gutter || !textareaEl) return;
    const scrollTop = textareaEl.scrollTop;
    for (const btn of $gutter.get(0).children) {
        const base = parseFloat(btn.dataset.baseTop) || 0;
        btn.style.top = `${base - scrollTop}px`;
    }
}

// ─── Render scheduling ──────────────────────────────────────────────────────

/**
 * Re-render on the next animation frame (i.e. before the browser paints
 * the keystroke). The old 60ms debounce meant freshly typed characters
 * were invisible — and the caret appeared to sit in the wrong spot —
 * until the timer fired, worse the faster you typed.
 */
function scheduleHighlight() {
    if (highlightFrame) return;
    highlightFrame = requestAnimationFrame(() => {
        highlightFrame = null;
        applyHighlight();
    });
}

function scheduleGutter() {
    clearTimeout(gutterTimer);
    gutterTimer = setTimeout(() => {
        if (textareaEl && lastFormat === 'xml') renderFoldGutter(textareaEl.value || '');
    }, GUTTER_DEBOUNCE_MS);
}

function applyHighlight() {
    if (!textareaEl || !codeEl || !$wrap) return;
    if (highlightFrame) {
        cancelAnimationFrame(highlightFrame);
        highlightFrame = null;
    }

    const text = textareaEl.value || '';
    if (text === lastRenderedText) return;
    lastRenderedText = text;

    const format = detectFormat(text);

    if (format === 'plain') {
        if (lastFormat !== 'plain') {
            $wrap.removeClass(ACTIVE_CLASS);
            $backdrop.hide();
            codeEl.textContent = '';
            $gutter.empty().hide();
            clearTimeout(gutterTimer);
        }
        lastFormat = 'plain';
        return;
    }

    const html = format === 'xml' ? tokenizeXml(text) : tokenizeKeyValue(text);
    // Trailing newline keeps the backdrop's scroll height matching the
    // textarea's when the value ends with '\n'.
    codeEl.innerHTML = `${html}\n`;

    if (format !== lastFormat) {
        $backdrop.attr('data-format', format).show();
        $wrap.addClass(ACTIVE_CLASS);
        if (format !== 'xml') $gutter.empty().hide();
    }
    lastFormat = format;

    syncScrollbarWidth();
    syncScroll();

    if (format === 'xml') scheduleGutter();
}

// ─── Format detection ───────────────────────────────────────────────────────

const XML_TAG_PATTERN = /<\/?[A-Za-z_][\w:.-]*(?:\s[^<>]*)?\/?>/;
const KV_LINE_PATTERN = /^[A-Za-z][A-Za-z0-9 _'-]{0,40}:(\s|$)/;

function detectFormat(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return 'plain';
    if (XML_TAG_PATTERN.test(trimmed)) return 'xml';

    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return 'plain';

    let kv = 0;
    for (const l of lines) if (KV_LINE_PATTERN.test(l)) kv++;
    const looksLikeKeyValue = lines.length === 1 ? kv === 1 : kv / lines.length >= 0.6;
    return looksLikeKeyValue ? 'keyvalue' : 'plain';
}

// ─── XML tokenizer ──────────────────────────────────────────────────────────

const XML_TOKEN_PATTERN = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z_][\w:.-]*(?:\s[^<>]*?)?\/?>)|([^<]+)|(<)/g;
const XML_TAG_STRUCTURE_PATTERN = /^(<\/?)([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?>)$/;
const XML_ATTR_PATTERN = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/g;

function tokenizeXml(text) {
    const out = [];
    let match;
    XML_TOKEN_PATTERN.lastIndex = 0;
    while ((match = XML_TOKEN_PATTERN.exec(text)) !== null) {
        const [, comment, tag, plain, loneBracket] = match;
        if (comment) out.push(`<span class="rpg-hl-comment">${escapeHtml(comment)}</span>`);
        else if (tag) out.push(highlightXmlTag(tag));
        else if (plain) out.push(escapeHtml(plain));
        else if (loneBracket) out.push('&lt;');
    }
    return out.join('');
}

function highlightXmlTag(tag) {
    const m = tag.match(XML_TAG_STRUCTURE_PATTERN);
    if (!m) return escapeHtml(tag);
    const [, open, name, attrsRaw, close] = m;
    return `<span class="rpg-hl-punct">${escapeHtml(open)}</span>`
        + `<span class="rpg-hl-tag">${escapeHtml(name)}</span>`
        + (attrsRaw ? highlightXmlAttrs(attrsRaw) : '')
        + `<span class="rpg-hl-punct">${escapeHtml(close)}</span>`;
}

function highlightXmlAttrs(attrsRaw) {
    let out = '';
    let last = 0;
    let m;
    XML_ATTR_PATTERN.lastIndex = 0;
    while ((m = XML_ATTR_PATTERN.exec(attrsRaw)) !== null) {
        if (m.index > last) out += escapeHtml(attrsRaw.slice(last, m.index));
        out += `<span class="rpg-hl-attr-name">${escapeHtml(m[1])}</span>`;
        out += escapeHtml(m[2]);
        out += `<span class="rpg-hl-attr-value">${escapeHtml(m[3])}</span>`;
        last = XML_ATTR_PATTERN.lastIndex;
    }
    if (last < attrsRaw.length) out += escapeHtml(attrsRaw.slice(last));
    return out;
}

// ─── Key:value tokenizer ────────────────────────────────────────────────────

const KV_TOKEN_PATTERN = /^(\s*)([A-Za-z][A-Za-z0-9 _'-]{0,40}?)(\s*:\s?)([\s\S]*)$/;

function tokenizeKeyValue(text) {
    return text.split('\n').map(highlightKvLine).join('\n');
}

function highlightKvLine(line) {
    const m = line.match(KV_TOKEN_PATTERN);
    if (!m) return escapeHtml(line);
    const [, indent, key, colonPart, rest] = m;
    return escapeHtml(indent)
        + `<span class="rpg-hl-key">${escapeHtml(key)}</span>`
        + `<span class="rpg-hl-punct">${escapeHtml(colonPart)}</span>`
        + `<span class="rpg-hl-value">${escapeHtml(rest)}</span>`;
}

// ─── Section folding ────────────────────────────────────────────────────────

const BARE_OPEN_TAG_LINE = /^(\s*)<([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?>\s*$/;
const BARE_CLOSE_TAG_LINE = /^(\s*)<\/([A-Za-z_][\w:.-]*)>\s*$/;
const COLLAPSED_PLACEHOLDER_LINE = /^(\s*)<([A-Za-z_][\w:.-]*)>…<\/\2>\s*$/;

function scanFoldRegions(text) {
    const lines = text.split('\n');
    const occurrenceCount = new Map();
    const stack = [];
    const regions = [];

    const nextKey = (tagName) => {
        const occ = occurrenceCount.get(tagName) || 0;
        occurrenceCount.set(tagName, occ + 1);
        return `${tagName}#${occ}`;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Cheap pre-filter: every foldable line starts with '<' after indent.
        if (line.trimStart().charCodeAt(0) !== 60) continue;

        const collapsedMatch = line.match(COLLAPSED_PLACEHOLDER_LINE);
        if (collapsedMatch) {
            const [, indent, tagName] = collapsedMatch;
            const key = nextKey(tagName);
            if (collapsedRegions.has(key)) {
                regions.push({ key, tagName, kind: 'collapsed', line: i, indent });
            }
            continue;
        }

        const openMatch = line.match(BARE_OPEN_TAG_LINE);
        if (openMatch) {
            stack.push({ tagName: openMatch[2], startLine: i, indent: openMatch[1] });
            continue;
        }

        const closeMatch = line.match(BARE_CLOSE_TAG_LINE);
        if (closeMatch) {
            const tagName = closeMatch[2];
            for (let j = stack.length - 1; j >= 0; j--) {
                if (stack[j].tagName === tagName) {
                    const opened = stack.splice(j)[0];
                    if (i > opened.startLine) {
                        regions.push({
                            key: nextKey(tagName),
                            tagName,
                            kind: 'expanded',
                            startLine: opened.startLine,
                            endLine: i,
                            indent: opened.indent,
                        });
                    }
                    break;
                }
            }
        }
    }

    return regions;
}

function setValuePreservingView(text) {
    const scrollTop = textareaEl.scrollTop;
    textareaEl.value = text;
    textareaEl.scrollTop = scrollTop;
}

function toggleFold(region) {
    if (!textareaEl) return;
    const lines = (textareaEl.value || '').split('\n');
    let caretLine;

    if (region.kind === 'expanded') {
        const original = lines.slice(region.startLine, region.endLine + 1).join('\n');
        collapsedRegions.set(region.key, original);
        lines.splice(region.startLine, region.endLine - region.startLine + 1,
            `${region.indent}<${region.tagName}>…</${region.tagName}>`);
        caretLine = region.startLine;
    } else {
        const original = collapsedRegions.get(region.key);
        if (original == null) return;
        collapsedRegions.delete(region.key);
        lines.splice(region.line, 1, original);
        caretLine = region.line;
    }

    setValuePreservingView(lines.join('\n'));
    // Put the caret at the start of the toggled line instead of letting the
    // browser dump it at the end of the document.
    let pos = 0;
    for (let i = 0; i < caretLine; i++) pos += lines[i].length + 1;
    textareaEl.setSelectionRange(pos, pos);

    applyHighlight();
}

function renderFoldGutter(text) {
    if (!$gutter || !textareaEl) return;
    const gutterEl = $gutter.get(0);

    const regions = scanFoldRegions(text);
    gutterEl.textContent = '';

    if (!regions.length) {
        $gutter.hide();
        return;
    }
    $gutter.show();

    const cs = getComputedStyle(textareaEl);
    const offsetTop = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
    const lineHeight = parseFloat(cs.lineHeight) || 18;
    const scrollTop = textareaEl.scrollTop;

    const lineIndices = regions.map((r) => (r.kind === 'collapsed' ? r.line : r.startLine));
    const tops = measureLineTops(text, lineIndices, cs);

    const frag = document.createDocumentFragment();
    regions.forEach((region, idx) => {
        const baseTop = offsetTop + tops[idx] + Math.max(0, (lineHeight - 14) / 2);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = FOLD_BTN_CLASS;
        btn.dataset.key = region.key;
        btn.dataset.baseTop = String(baseTop);
        btn.style.top = `${baseTop - scrollTop}px`;
        btn.textContent = region.kind === 'collapsed' ? '▸' : '▾';
        btn.title = region.kind === 'collapsed'
            ? `Expand <${region.tagName}>`
            : `Collapse <${region.tagName}>`;
        frag.appendChild(btn);
    });
    gutterEl.appendChild(frag);
}

/**
 * Measures the vertical offset of several lines in ONE layout pass: the
 * mirror gets one block per source line, then each needed block's
 * offsetTop is read. (Previously each fold button re-filled the mirror
 * and forced its own layout — O(sections × text length) per keystroke,
 * which was the main source of the slowness.)
 */
function measureLineTops(fullText, lineIndices, cs) {
    if (!measurerEl || !lineIndices.length) return lineIndices.map(() => 0);

    const maxIdx = Math.max(...lineIndices);
    const lines = fullText.split('\n').slice(0, maxIdx + 1);

    // clientWidth excludes the scrollbar, so wrapping matches the textarea.
    const contentWidth = textareaEl.clientWidth
        - (parseFloat(cs.paddingLeft) || 0)
        - (parseFloat(cs.paddingRight) || 0);

    const ms = measurerEl.style;
    ms.width = `${Math.max(0, contentWidth)}px`;
    ms.boxSizing = 'content-box';
    ms.padding = '0';
    ms.border = '0';
    ms.margin = '0';
    ms.whiteSpace = 'pre-wrap';
    ms.overflowWrap = cs.overflowWrap;
    ms.wordBreak = cs.wordBreak;
    ms.fontFamily = cs.fontFamily;
    ms.fontSize = cs.fontSize;
    ms.fontWeight = cs.fontWeight;
    ms.lineHeight = cs.lineHeight;
    ms.letterSpacing = cs.letterSpacing;
    ms.wordSpacing = cs.wordSpacing;
    ms.tabSize = cs.tabSize;
    ms.fontVariantLigatures = 'none';

    // Zero-width space keeps empty lines one line tall.
    measurerEl.innerHTML = lines
        .map((l) => `<div>${l ? escapeHtml(l) : '\u200b'}</div>`)
        .join('');

    const children = measurerEl.children;
    const tops = lineIndices.map((i) => (children[i] ? children[i].offsetTop : 0));
    measurerEl.textContent = '';
    return tops;
}