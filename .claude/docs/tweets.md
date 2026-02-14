# Tweet Options

---

## Intelligent Playback (Claude Vision + DOM)
**Tag**: #intelligent-playback
**Date**: 2026-02-14

### Tweet 1 (Technical)
Built a browser automation agent that sees screenshots AND reads the DOM simultaneously. Claude gets a page snapshot with 100 interactive elements + their selectors, then decides what to click. No pre-programmed selectors. It figures out the page in real time.

### Tweet 2 (Visual/Demo)
Watch this: record a workflow once, then play it on a completely different page layout. The agent sees the screenshot, reads the DOM, and navigates autonomously. Every action shows a blue highlight pulse before executing. It just works.

### Tweet 3 (Problem/Solution)
Browser macros break the moment a site updates. CSS selectors rot overnight. So we gave the playback agent eyes. It sees the actual page via screenshots, understands the DOM structure, and decides what to do next. Site redesign? It adapts.

### Tweet 4 (Hot Take)
Every browser automation tool that relies on CSS selectors is building on sand. The future is vision + structured DOM. Selectors are a hint, not the truth. The page screenshot IS the truth. We built both into the same loop.

### Tweet 5 (Thread Opener)
We added a learning system to browser playback. First run: Claude figures out the workflow from scratch. Second run: it starts with insights from what worked before. By the fifth run, it nails the workflow in half the actions. Here's how the learning loop works.

### What to Show Off
**Format**: video
**Duration**: 30s

**UX Workflow to Demo**:
1. Show a recorded workflow in the extension popup on a Hypeddit track page
2. Click Play and watch the service worker console showing Claude's reasoning per step
3. Show the completion card with "Done! Track downloaded"

**What Makes It Visual**:
- Blue element highlight pulses before each action
- Step progress overlay with checkmarks
- Console log showing Claude's reasoning ("clicking Follow button, confidence 0.95")
- Second run showing fewer actions needed (learning effect)

**Framing Notes**:
- Split screen: browser on left, service worker console on right
- Start from a fresh Hypeddit track page (not the one that was recorded)
- Make sure SoundCloud/Spotify are logged in so gates complete

---
