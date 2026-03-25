import type { ToolDefinition } from '../types';

/** Browser tool schemas sent to the Claude Code API on the first request. */
export const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'page_snapshot',
    description:
      'Take a snapshot of the current page. Returns page title, URL, forms, interactive elements (with index refs), headings, navigation links, and main content. Use this to understand the page structure before generating tools.',
  },
  {
    name: 'evaluate_js',
    description:
      'Execute JavaScript code in the browser page context. The code runs with full DOM access and supports async/await. Returns the return value, any console output captured during execution, and errors. Use this to test generated tool code, inspect DOM elements, or verify that selectors and queries work correctly.',
    parameters: {
      code: {
        type: 'string',
        description:
          'JavaScript code to execute. Can use async/await. Has full DOM access (document, window, etc.).',
        required: true,
      },
    },
  },
  {
    name: 'get_console_logs',
    description:
      'Get recent browser console output (log, warn, error, info). Use after evaluate_js to check for errors or unexpected output, or to monitor page behavior.',
    parameters: {
      since_ms: {
        type: 'number',
        description:
          'Only return entries after this Unix timestamp (epoch ms). Omit for all buffered entries.',
      },
    },
  },
  {
    name: 'get_network_requests',
    description:
      'Get recent network requests made by the page. Shows URL, type (fetch/xhr/script/etc.), duration, transfer size, and HTTP status. Use to verify API calls made by generated tools.',
    parameters: {
      since_ms: {
        type: 'number',
        description:
          'Only return entries after this Unix timestamp (epoch ms). Omit for all buffered entries.',
      },
    },
  },
];
