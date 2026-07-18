# Jarvis live result interface

Use `ui_show` when a structured result is easier to scan than chat text. The current Jarvis workbench renders trusted, data-only cards and never executes interface code received from the model.

## Supported cards

- `WeatherCard`: weather, temperature, wind, and a short forecast.
- `SelfCheckCard`: a completed list of system checks.
- `SelfCheckStepCard`: one step in an ongoing system check.
- `AwakeningCard`: a short system finding or startup observation.
- Other registered names: shown as a safe key/value result.

Keep props concise. Lists are capped by the workbench and cards close automatically. Use `ui_update` to refresh an existing card and `ui_hide` when a result is no longer relevant.

## Weather example

```json
{
  "component": "WeatherCard",
  "props": {
    "city": "Shanghai",
    "temp": 31,
    "condition": "Cloudy",
    "feel": 34,
    "wind": "SE 3",
    "forecast": [
      { "day": "Today", "high": 33, "low": 27 },
      { "day": "Tomorrow", "high": 32, "low": 26 }
    ]
  }
}
```

Do not invent live values. Fetch or calculate the data first, then show the result. Do not use `inline-template`, `inline-script`, or `ui_register` for routine answers: the desktop deliberately treats model-provided executable UI as untrusted and does not run it.
