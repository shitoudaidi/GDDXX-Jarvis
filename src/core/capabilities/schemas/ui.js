// Safe, data-only live results rendered by the current Jarvis workbench.
export const uiSchemas = {
  ui_show: {
    type: 'function',
    function: {
      name: 'ui_show',
      description: `Show a trusted structured result in the current Jarvis workbench. Use only when a visual result is easier to scan than chat text. Supported components:
- WeatherCard props: city, temp, condition, desc, feel, high, low, wind, forecast.
- SelfCheckCard props: results [{ name, status, note? }], overall.
- SelfCheckStepCard props: step, total, name.
- AwakeningCard props: index, total, title, finding.
The workbench displays data only. It does not execute HTML, JavaScript, or model-generated components.`,
      parameters: {
        type: 'object',
        properties: {
          component: {
            type: 'string',
            enum: ['WeatherCard', 'SelfCheckCard', 'SelfCheckStepCard', 'AwakeningCard'],
            description: 'One of the four supported workbench result components.'
          },
          props: {
            type: 'object',
            description: 'Structured component data. Keep strings and lists concise.'
          }
        },
        required: ['component', 'props']
      }
    }
  },

  ui_hide: {
    type: 'function',
    function: {
      name: 'ui_hide',
      description: 'Close a live result card. Usually let the user or automatic timeout close it; call this when its data is stale.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card instance id returned by ui_show.' }
        },
        required: ['id']
      }
    }
  },

  ui_update: {
    type: 'function',
    function: {
      name: 'ui_update',
      description: 'Shallow-merge new props into a displayed result without replaying its enter animation.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card instance id returned by ui_show.' },
          props: { type: 'object', description: 'New structured data to merge into the card.' }
        },
        required: ['id', 'props']
      }
    }
  },

  ui_patch: {
    type: 'function',
    function: {
      name: 'ui_patch',
      description: 'Apply a small data patch to a displayed result. Prefer ui_update for ordinary field changes.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card instance id returned by ui_show.' },
          op: { type: 'string', enum: ['merge', 'replace', 'append'], description: 'Patch operation.' },
          data: { type: 'object', description: 'Patch data. append accepts key and value.' }
        },
        required: ['id', 'op', 'data']
      }
    }
  }
}
