# Iteration 21 - Verified packaged Windows runtime

1. The accessibility gate rejected a valid multi-ID description; it now checks that turn-status is included.
2. Builder success did not prove the branded executable existed; pack now verifies the EXE and size.
3. The application ASAR was not checked after packaging; it now has a presence and size gate.
4. Embedded Python could be omitted unnoticed; packaged python.exe is now required.
5. Whisper could exist in source but not the app; the packaged model is now required.
6. Jarvis voice could be absent from the app; the packaged ONNX model is now required.
7. Voice metadata could be omitted; the ONNX JSON companion is now required.
8. ASR or TTS scripts could be excluded by ASAR rules; both packaged scripts are now required.
9. better-sqlite3 could miss its Electron-native binary; the native module is now verified.
10. A developer config could leak into the public build; packaged config.json locations must be absent.
