# Jarvis Visual Direction v0.1

## Design Read

Reading this as a product interface for a personal AI assistant, with a private laboratory and tactical HUD language, leaning toward a cinematic blue telemetry cockpit with a living particle intelligence at the center.

## Physical Scene

The user opens Jarvis at night or early morning on a desktop screen. The room is quiet. The interface should feel like a private control room waking up: dark, precise, blue, alive, and waiting.

## Direction Name

Deep Blue Tactical Consciousness

## Core Feeling

Jarvis is not a chatbot window. Jarvis is an intelligent presence. The interface should make the user feel that something is online, listening, and ready.

## Visual Principles

1. Center presence first.
   The particle intelligence is the main character. All panels orbit around it.

2. Information is calm until needed.
   Weather, AI Hot, tasks, and summaries are available, but not noisy.

3. Motion communicates state.
   Idle, listening, thinking, speaking, and alert states must look different.

4. Blue is material, not decoration.
   Use blue as light, atmosphere, depth, and signal. Avoid random neon outlines.

5. Red means something serious.
   Red/orange appears only for API errors, danger, urgent reminders, or system faults.

## Screen Anatomy

### Top System Rail

- `JARVIS`
- local service status
- DeepSeek status
- voice status
- current time
- system mode: local, online, listening, speaking

### Center Intelligence Core

Three shape modes:

- Particle face: appears when Jarvis speaks or addresses the user.
- Mist core: default idle and sleep state.
- Wireframe sphere: thinking, summarizing, or searching.

Visual material:

- cyan particles
- soft blue volumetric fog
- thin orbital rings
- subtle radial grid
- waveform pulse when speaking

### Left Environmental Panel

Purpose: situational awareness.

Content:

- weather
- city
- temperature
- air quality
- date
- next calendar item
- morning/evening status

### Right Intelligence Panel

Purpose: daily briefing and active information.

Content:

- AI Hot summary
- DeepSeek response outline
- important news
- current tasks
- last commands

### Bottom Voice Console

Purpose: conversation control.

Content:

- microphone state
- live transcript
- generated reply text
- waveform
- wake phrase hints

Shape:

- shallow holographic arc
- translucent but readable
- thin cyan rails
- no oversized rounded chat box

## State Language

### Idle

Mist core breathes slowly. Side panels are dim. Bottom console says:

`我在。`

### Wake

Outer ring expands once. Particles brighten from center outward.

User says:

`你好，贾维斯。`

Jarvis replies:

`你好，我已上线。`

### Morning

Core shifts from mist to calm face-like particle structure.

Jarvis replies:

`早上好。天气、日程和今日摘要已经准备好。`

### Listening

Bottom waveform becomes active. Center particles align to the incoming voice rhythm.

UI text:

`正在聆听。`

### Thinking

Particles contract into a wireframe sphere. Fine data lines move toward the right panel.

UI text:

`正在分析。`

### Speaking

Particle face stabilizes. Waveform glows with the TTS audio. Side panels lower in contrast.

UI text:

`正在回应。`

### Alert

Only critical elements shift to red/orange. The whole interface should not become red.

UI text:

`需要注意。`

## Palette Draft

- Background: `#03070D`
- Deep surface: `#071421`
- Panel surface: `#0B1B2B`
- Primary cyan: `#54E4FF`
- Electric blue: `#1B8CFF`
- Soft text: `#EAF7FF`
- Muted text: `#82A7BC`
- Hairline: `rgba(84, 228, 255, 0.28)`
- Emergency: `#FF4D3D`
- Warning amber: `#FFB84D`

## Typography Draft

- Display/UI: Geist, Satoshi, or Space Grotesk.
- Technical mono: JetBrains Mono or IBM Plex Mono.
- Avoid default Inter unless a later implementation already depends on it.
- Labels stay small and readable, not decorative.
- Chinese copy must be calm, short, and service-oriented.

## Motion Identity

Motion archetype: premium and calm.

Timing:

- micro feedback: 100-180 ms
- panel transitions: 250-400 ms
- wake animation: 600-900 ms
- mist and ambient breathing: 4-8 s loops

Easing:

- primary: `cubic-bezier(0.4, 0, 0.2, 1)`
- entrance: decelerating ease-out
- exit: faster ease-in

Motion layers:

- primary: central particle body
- secondary: rings, waveforms, panel focus
- ambient: fog, grid glow, faint scanlines

## First Design Set To Generate

Generate three horizontal main-screen directions:

1. Central Consciousness Core
   Minimal panels, massive particle intelligence, strongest emotional presence.

2. Private Lab Cockpit
   More hardware-like, with bottom arc console and left/right tactical panels.

3. AI Briefing Chamber
   Stronger right-side AI Hot and daily-summary focus, with the intelligence core still central.

Each design must be one screen only. Do not generate a marketing landing page.
