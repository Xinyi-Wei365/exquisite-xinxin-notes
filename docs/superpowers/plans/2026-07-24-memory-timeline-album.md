# Memory Timeline Album Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render image notes in the memory space as a grouped, date-editable timeline photo album.

**Architecture:** Keep the note model and cloud persistence unchanged. Add a focused renderer that filters memory image notes, groups them by `recordDate`, and produces timeline markup. Existing non-image memory notes remain in the standard notes grid.

**Tech Stack:** Native HTML, CSS, JavaScript, IndexedDB, Supabase REST/Storage.

---

### Task 1: Add timeline rendering

**Files:**
- Modify: `script.js`
- Modify: `tests/account-settings.test.js`

- [ ] Write a failing test requiring `renderMemoryTimeline`, `.photo-timeline`, and `.photo-date-input`.
- [ ] Run `node --test tests/account-settings.test.js` and confirm the test fails.
- [ ] Group memory image notes by `recordDate`, newest first, and render date rail plus uniform photo cards.
- [ ] Run the test again and confirm it passes.

### Task 2: Connect direct date edits

**Files:**
- Modify: `script.js`
- Modify: `tests/account-settings.test.js`

- [ ] Add a failing test for the memory image filter and `persist(note, false)` date save path.
- [ ] Split memory images from other notes in `renderNotes()` and preserve non-image note cards.
- [ ] Re-render after inline date changes so a photo moves to its new date group.
- [ ] Run `node --test tests/account-settings.test.js` and confirm it passes.

### Task 3: Add responsive photo-album styles

**Files:**
- Modify: `styles.css`
- Modify: `tests/account-settings.test.js`

- [ ] Add a failing test for `.photo-timeline`, a three-column desktop grid, and the mobile media query.
- [ ] Add the confirmed left date rail, uniform near-square cards, restrained second-card offset, and two-column mobile layout.
- [ ] Hide date editing controls for viewer mode.
- [ ] Run `node --test tests/account-settings.test.js; node --check script.js; node --check cloud.js; git diff --check`.

### Task 4: Verify and publish

**Files:**
- Modify: `script.js`, `styles.css`, `tests/account-settings.test.js`

- [ ] Verify timeline groups, visible thumbnails, inline date edits, reader opening, and mobile two-column layout locally.
- [ ] Commit the feature and publish to GitHub Pages.
- [ ] Confirm the Pages deployment succeeds and the production site loads.
