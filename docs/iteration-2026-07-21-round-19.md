# Iteration 19 - Safe public error messages

1. Bearer tokens could appear in provider errors; they are now redacted.
2. Common sk-prefixed keys could be returned to the UI; they are now masked.
3. API keys in query strings could leak; credential query parameters are now scrubbed.
4. Authorization header fragments could leak; known auth headers are now scrubbed.
5. JSON apiKey and accessKey values could leak; they are now masked.
6. JSON token, secret, and password values could leak; they are now masked.
7. URLs containing user-info credentials could leak; user info is now removed.
8. Provider control characters could corrupt terminal rendering; unsafe controls are removed.
9. Huge upstream error bodies could overwhelm the UI; public errors are capped at 1,000 characters.
10. Nested error arrays and objects bypassed route-by-route fixes; every JSON response now sanitizes error, warning, and reason fields recursively.
