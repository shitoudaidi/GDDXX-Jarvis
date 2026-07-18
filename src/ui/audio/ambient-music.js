import { applyOutputSink } from "./audio-output.js";

const STORAGE_KEY = "jarvis-ambient-music-enabled";
const NORMAL_VOLUME = 0.12;
const DUCKED_VOLUME = 0.018;
const TRACKS = [
  {
    id: "cornfieldChase",
    title: "Cornfield Chase",
    previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/3a/ee/23/3aee2300-f6f7-a006-e20f-28092e814cbe/mzaf_1624587954644600228.plus.aac.p.m4a",
  },
  {
    id: "noTimeForCaution",
    title: "No Time for Caution",
    previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/9a/74/a8/9a74a85f-9868-3884-7279-6973c42687eb/mzaf_3713674463528032297.plus.aac.p.m4a",
  },
  {
    id: "interstellarTheme",
    title: "Day One (Interstellar Theme)",
    previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/0e/76/d3/0e76d3f4-0071-b9ef-81d4-76c445ebc69d/mzaf_17653548405030492062.plus.aac.p.m4a",
  },
];

let player = null;
let currentTrack = 0;
let playbackRequested = false;
let ducked = false;
let playbackGeneration = 0;
let fadeFrame = 0;
let playlistPromise = null;

function targetVolume() {
  return ducked ? DUCKED_VOLUME : NORMAL_VOLUME;
}

function cancelVolumeFade() {
  if (fadeFrame) cancelAnimationFrame(fadeFrame);
  fadeFrame = 0;
}

function fadeVolume(volume, duration) {
  if (!player) return;
  cancelVolumeFade();
  const audio = player;
  const from = audio.volume;
  const started = performance.now();
  const tick = (now) => {
    if (audio !== player) return;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    audio.volume = from + (volume - from) * eased;
    if (progress < 1) fadeFrame = requestAnimationFrame(tick);
    else fadeFrame = 0;
  };
  fadeFrame = requestAnimationFrame(tick);
}

async function resolvePlaylist() {
  if (!playlistPromise) {
    playlistPromise = Promise.resolve(window.jarvisDesktop?.getMusicTracks?.())
      .catch(() => ({}))
      .then((localTracks = {}) => TRACKS.map((track) => ({
        ...track,
        source: localTracks[track.id] || track.previewUrl,
        local: Boolean(localTracks[track.id]),
      })));
  }
  return playlistPromise;
}

async function playTrack(index, failedTracks = 0) {
  const playlist = await resolvePlaylist();
  if (!playbackRequested || !playlist.length || failedTracks >= playlist.length) return false;

  currentTrack = ((index % playlist.length) + playlist.length) % playlist.length;
  const track = playlist[currentTrack];
  const generation = ++playbackGeneration;
  if (player) {
    player.onended = null;
    player.onerror = null;
    player.pause();
  }

  const audio = new Audio(track.source);
  player = audio;
  audio.preload = "auto";
  audio.volume = targetVolume();
  await applyOutputSink(audio).catch(() => {});

  let advancing = false;
  const advanceAfterFailure = async () => {
    if (advancing || generation !== playbackGeneration || !playbackRequested) return false;
    advancing = true;
    return playTrack(currentTrack + 1, failedTracks + 1);
  };
  audio.onended = () => {
    if (generation === playbackGeneration && playbackRequested) playTrack(currentTrack + 1, 0);
  };
  audio.onerror = () => { advanceAfterFailure(); };

  try {
    await audio.play();
    return true;
  } catch {
    return advanceAfterFailure();
  }
}

export function isAmbientMusicEnabled() {
  return localStorage.getItem(STORAGE_KEY) !== "0";
}

export async function startAmbientMusic() {
  localStorage.setItem(STORAGE_KEY, "1");
  playbackRequested = true;
  if (player && player.paused && !player.error) {
    player.volume = targetVolume();
    try {
      await player.play();
      return true;
    } catch {}
  }
  if (player && !player.paused) return true;
  return playTrack(currentTrack, 0);
}

export function stopAmbientMusic() {
  localStorage.setItem(STORAGE_KEY, "0");
  playbackRequested = false;
  playbackGeneration += 1;
  cancelVolumeFade();
  if (player) {
    player.onended = null;
    player.onerror = null;
    player.pause();
    player.currentTime = 0;
  }
}

export function setAmbientMusicDucked(nextDucked) {
  ducked = Boolean(nextDucked);
  fadeVolume(targetVolume(), ducked ? 420 : 900);
}
