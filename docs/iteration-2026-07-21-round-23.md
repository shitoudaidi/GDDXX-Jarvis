# Iteration 23 - Downloadable Windows installer

1. A source-only pass could hide a broken installer; the exact 0.3.0 installer must exist.
2. An old release could be mistaken for current; the filename must contain the package version.
3. A truncated upload could look valid; the installer must contain the full local voice payload.
4. A renamed text file could pass a name check; the artifact must have a Windows PE header.
5. Differential updates could break; a substantial blockmap is required.
6. Update metadata could advertise the wrong version; latest.yml must match 0.3.0.
7. Update metadata could point at another file; its path must match the exact installer.
8. Downloads had no local integrity proof; the probe now writes a SHA-256 sidecar.
9. A stale checksum could be published; it is recomputed and compared byte for byte.
10. Clean-PC setup could be opaque; NSIS must remain guided and allow directory choice.
