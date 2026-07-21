# Iteration 20 - Traceable 0.3.0 release

1. Nineteen rounds still identified as 0.2.5; the product version is now 0.3.0.
2. The lockfile root could diverge from package metadata; it now matches 0.3.0.
3. The lockfile workspace package could diverge too; it now matches 0.3.0.
4. Users could not see the running version; the footer now shows the Electron package version.
5. Version display could be hardcoded and stale; it is read through the existing preload bridge.
6. A Git tag could publish the wrong package version; tagged CI now requires an exact match.
7. Release notes were generated without a curated product summary; 0.3.0 notes are now included.
8. Curated notes were not attached to GitHub Release; the workflow now uses RELEASE_NOTES.md.
9. Installer identity and versioned artifact naming were implicit; the release contract now verifies both.
10. Checksum publication could regress unnoticed; the release contract now requires the SHA-256 artifact.
