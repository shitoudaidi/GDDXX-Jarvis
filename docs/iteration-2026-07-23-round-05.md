# Iteration 05 - First-run conversation readiness

1. [Conversation] The setup form description was not programmatically linked to the form; it now explains the form to assistive technology.
2. [Function] The provider control had no field name; submissions and browser tooling can now identify it.
3. [Function] The model field had no field name; it now has a stable form key.
4. [Function] Model names could be mistaken for personal data by autofill; ordinary autofill is now disabled.
5. [Function] Model requiredness was only visual/native; it now has explicit ARIA required semantics.
6. [Function] The model API key had no field name; it now has a stable secret field key.
7. [Function] The API key required state was not explicit to assistive technology; it now is.
8. [Function] Custom endpoints lacked mobile URL keyboard hints and URL autocomplete semantics; both are now declared.
9. [Function] The voice provider legend had no stable reference; it now labels the choice group.
10. [Conversation] Both voice choices now reference the shared legend, making local/cloud selection understandable in isolation.
