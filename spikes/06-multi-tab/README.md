# Spike 06 — Multi-tab single-owner (Phase 13)

**Goal:** validate the Web Lock based "only one tab owns the DB" design end to
end in a real Chromium against the dev frontend.

The hosted shape opens a single OPFS sync access handle per origin. Without
coordination, opening a second tab makes the second Worker silently fall back to
in-memory and diverge from the first. Phase 13's modal-only design uses a named
Web Lock (`hipo-db`) — the first tab acquires it for the page lifetime;
subsequent tabs see the lock held and render `MultiTabBlock` until the holder
releases.

This spike is the load-bearing test for that primitive.

## What it covers

1. Tab A boots → acquires `hipo-db` Web Lock → renders bootstrap UI.
2. Tab B opens against the same origin → lock probe fails → renders
   MultiTabBlock with the i18n'd "already open" copy.
3. Tab A closes → its lock releases. Tab B's polling (`observeLockReleased`)
   notices within ~1 s and auto-reloads.
4. Tab B's reload now acquires the lock cleanly and renders the bootstrap UI.

## Run

### Local dev (`multi-tab.mjs`)

```bash
node spikes/06-multi-tab/multi-tab.mjs
```

Exits `0` on green; non-zero if any assertion fails. The script starts
`apps/hipo/frontend` in `dev:inpage` mode itself, drives Playwright through both
tabs, and cleans up its own dev server in `finally`.

### Deployed Pages parity (`multi-tab-pages.mjs`)

```bash
node spikes/06-multi-tab/multi-tab-pages.mjs               # both engines
node spikes/06-multi-tab/multi-tab-pages.mjs chromium      # one engine
PAGES_URL=https://example.com/ node spikes/06-multi-tab/multi-tab-pages.mjs
```

Runs the same multi-tab flow against `https://a-d-j-i.github.io/hipo/hipo/` (or
`$PAGES_URL`) under both Chromium and WebKit. No frontend spawn. Requires
`npx playwright install` to have pulled the WebKit driver. Verified PASS
2026-05-25 against deployed commit `2abeca8` in both engines.

## What it does NOT cover

- True webkit2gtk runtime — Playwright's WebKit is desktop-Safari WebKit, not
  webkit2gtk 2.50.6. The Web Locks API has been in upstream WebKit since
  Safari 15.4 (2022), so webkit2gtk 2.50.6 supports it; strict
  webkit2gtk-engine testing would require Epiphany or wry against the live URL
  but is not a separate spec surface from Playwright's WebKit for this
  primitive.
- Three-or-more tabs — the lock primitive degenerates trivially (any tab beyond
  the first sees the lock held); two is enough to exercise the semantics.
- Tauri shape — single-window by default, multi-tab is moot.
