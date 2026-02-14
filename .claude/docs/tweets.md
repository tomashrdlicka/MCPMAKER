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

## Native macOS App (Swift/SwiftUI + Metal)
**Tag**: #macos-native-app
**Date**: 2026-02-14

### Tweet 1 (Technical)
Rebuilt our browser automation tool as a native macOS app. SwiftUI menubar, Metal shaders for the UI, Chrome DevTools Protocol over WebSocket for browser control. No extension install. No API keys. Just a lotus icon in your menubar. Click record, do your thing, press play.

### Tweet 2 (Visual/Demo)
A lotus flower in your menubar that breathes while recording and blooms when done. Metal shaders driving every frame. Frosted glass panels floating over your desktop. This is what browser automation looks like when you treat it as a consumer product, not a dev tool.

### Tweet 3 (Problem/Solution)
Chrome extensions have a trust problem. Users see "this extension can read all your data" and bounce. So we moved everything to a native Mac app that controls Chrome from the outside via CDP. Same power, zero extension permissions, and a UI that actually feels like macOS.

### Tweet 4 (Architecture)
The architecture: SwiftUI menubar app talks to Chrome via CDP WebSocket. A bundled Node.js engine runs locally for analysis. Claude calls route through our proxy for billing. Recording polls DOM events from an injected script. Playback executes actions through the same script. All orchestrated from Swift actors.

### Tweet 5 (Thread Opener)
We turned a Chrome extension into a native macOS app in one session. 40 files, 5300 lines of Swift/Metal/JS. Here's why we did it and what the architecture looks like.

### What to Show Off
**Format**: video
**Duration**: 45s

**UX Workflow to Demo**:
1. Show the lotus icon idle in the menubar (subtle gradient)
2. Click it, show the glass dropdown, click Record
3. Enter a URL, Chrome launches
4. Interact with the site (lotus breathing in menubar)
5. Stop recording (lotus blooms, success flash)
6. Show "Workflow captured" card with step count
7. Click Play, show PiP panel floating with progress dots
8. Completion: PiP shows checkmark, auto-dismisses

**What Makes It Visual**:
- Metal shader lotus animation transitions (idle -> breathing -> bloom -> success)
- Frosted glass panels with light refraction
- Floating PiP progress panel over the desktop
- Chrome launching and being controlled with no extension visible
- Clean menubar dropdown with workflow list

**Framing Notes**:
- Focus on the feel: smooth animations, glass effects, minimal chrome
- Show it on a real site (Spotify, GitHub, etc.) to demonstrate practical use
- Contrast with "install this extension" flow from before
- End card: "No extension. No API key. Just press play."

---
