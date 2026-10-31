// Loads three.js as a module, hands it to the HUD scripts on window, then runs them in order.
// The HUD scripts are classic scripts on purpose: they share one global scope, so each file can use what the
// files before it declared (the scene, the core, the skins...) without a bundler. Order matters.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
Object.assign(window, { THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
const PARTS = ['core.js', 'nav.js', 'machine.js', 'render.js', 'hand.js', 'skins.js', 'cores/kit.js', 'cores/neural.js', 'cores/nebula.js', 'cores/ion.js', 'cores/works.js', 'cores/factory.js', 'cores/spider.js', 'cores/ops.js', 'skin-picker.js', 'demos.js', 'demo-mode.js', 'loop.js', 'panels.js', 'creator.js', 'interaction.js', 'subtitles.js', 'talk.js', 'live.js', 'holo-lib.js', 'earth-migration.js', 'tour.js', 'brain-window.js', 'voiceprint.js', 'start.js'];
for (const p of [...PARTS, 'onboard.js']) {
  const s = document.createElement('script');
  s.src = 'js/' + p; s.async = false;
  document.body.appendChild(s);
}
