// 联网工具 schema：web_search / fetch_url / browser_read
// 注意：fetch_url / browser_read 在 function 外层带 recognizer_highlights，
// 供识别器使用，getToolSchemas 会在发给 LLM 前剥离该字段。
export const webSchemas = {
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current or unknown information. Use this before fetch_url when you do not already know the exact reliable URL. Returns structured JSON with result titles, URLs, snippets, and ok/error status.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query. Be specific, include product/version/date keywords when relevant.'
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return, default 5, max 8.'
          }
        },
        required: ['query']
      }
    }
  },

  fetch_url: {
    type: 'function',
    recognizer_highlights: ['body_path', 'title', 'url', 'content_length'],
    function: {
      name: 'fetch_url',
      description: 'Open a known URL with a lightweight HTTP request. Returns structured JSON with ok/status/title/content/body_path/error. Long articles (>=2000 chars) are auto-saved to sandbox/articles/ and content is truncated to a short excerpt; use the returned body_path with read_file to open the full text. Do not use this tool as a search engine. If ok is false because content is empty, blocked, or JS-rendered, try browser_read or another URL; never summarize an error as page content.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to open. Prefer reliable source pages found through web_search.'
          }
        },
        required: ['url']
      }
    }
  },

  browser_read: {
    type: 'function',
    recognizer_highlights: ['body_path', 'title', 'url', 'content_length'],
    function: {
      name: 'browser_read',
      description: 'Use a real headless Chromium browser to open and render a webpage, wait for JavaScript, scroll, and extract readable text. Use this when fetch_url returns no readable content, a waiting page, or a JS-rendered page. Returns structured JSON with ok/title/content/body_path/error. Long articles (>=2000 chars) are auto-saved to sandbox/articles/ and content is truncated to a short excerpt; use body_path with read_file to open the full text.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to open in the browser.'
          },
          timeout_ms: {
            type: 'number',
            description: 'Navigation/render timeout in milliseconds, default 20000, max 45000.'
          },
          max_chars: {
            type: 'number',
            description: 'Maximum extracted characters to return, default 8000, max 12000.'
          }
        },
        required: ['url']
      }
    }
  },
}
