/**
 * nbt_functions.js — Custom VoxGlide functions for IT Internal Tools (it-app.nextbt.ai)
 *
 * Standalone IIFE that exposes window.nbt_functions for VoxGlide auto-discovery.
 * Routes functions by URL pathname (global + page-specific).
 *
 * - createTask / createGithubIssue use the REST API directly (fast, reliable).
 * - File viewer handlers use DOM manipulation for visual feedback.
 * - searchTasks uses DOM manipulation (filters the visible task list).
 *
 * Load via: <script src="nbt_functions.js"></script>
 */
(function () {
  'use strict';

  // ── Helpers ──

  var PRIORITY_MAP = { low: 25, medium: 50, high: 75, urgent: 100 };

  /**
   * Set an input value using the native setter trick for React/Vue/Angular compatibility.
   */
  function setNativeValue(input, value) {
    var proto = input.tagName.toLowerCase() === 'textarea'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Global Functions (all pages) ──

  var globalFunctions = {
    createTask: {
      description: 'Create a new task in the IT Tools task tracker.',
      parameters: {
        title: { type: 'string', description: 'Task title', required: true },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Task priority', enum: ['low', 'medium', 'high', 'urgent'] },
        recurrence: { type: 'string', description: 'Recurrence pattern', enum: ['none', 'daily', 'weekly', 'monthly'] },
      },
      handler: async function (args) {
        var priorityLevel = args.priority || 'medium';
        var body = {
          title: args.title,
          description: args.description || null,
          priority: PRIORITY_MAP[priorityLevel] || 50,
          priorityLevel: priorityLevel,
          recurrenceType: (args.recurrence && args.recurrence !== 'none') ? args.recurrence : null,
          recurrenceConfig: null,
        };

        var res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          var err = await res.text();
          return { error: 'Failed to create task: ' + res.status + ' ' + err };
        }

        var data = await res.json();
        var taskId = data.task ? data.task.id : data.id;
        return { success: true, message: 'Task "' + args.title + '" created (id: ' + taskId + ')' };
      },
    },

    createGithubIssue: {
      description: 'Create a new GitHub issue in a repository.',
      parameters: {
        repository: { type: 'string', description: 'Repository name (e.g. "it-internal-tools" or "billiax/it-internal-tools")', required: true },
        title: { type: 'string', description: 'Issue title', required: true },
        description: { type: 'string', description: 'Issue body/description' },
        labels: { type: 'string', description: 'Comma-separated label names to apply' },
      },
      handler: async function (args) {
        // Resolve the full repo name (owner/repo format)
        var repo = args.repository;
        if (repo.indexOf('/') === -1) {
          // Fetch repos list to find the full name
          var reposRes = await fetch('/api/integrations/github/repos');
          if (reposRes.ok) {
            var reposData = await reposRes.json();
            var repos = reposData.repos || [];
            var match = repos.find(function (r) {
              return r.nameWithOwner.toLowerCase().endsWith('/' + repo.toLowerCase());
            });
            if (match) repo = match.nameWithOwner;
            else return { error: 'Repository "' + args.repository + '" not found. Available: ' + repos.map(function (r) { return r.nameWithOwner; }).join(', ') };
          }
        }

        var labelArr = [];
        if (args.labels) {
          labelArr = args.labels.split(',').map(function (l) { return l.trim(); }).filter(Boolean);
        }

        var body = {
          title: args.title,
          body: args.description || '',
          repo: repo,
          labels: labelArr,
        };

        var res = await fetch('/api/tasks/github/create-issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          var err = await res.text();
          return { error: 'Failed to create issue: ' + res.status + ' ' + err };
        }

        var data = await res.json();
        return { success: true, message: 'GitHub issue "' + args.title + '" created in ' + repo, data: data };
      },
    },
  };

  // ── File Viewer Functions (/tools/files/viewer) ──

  var fileViewerFunctions = {
    editDocument: {
      description: 'Edit the currently open document. Switches to edit mode if needed and sets the content.',
      parameters: {
        content: { type: 'string', description: 'The new content for the document', required: true },
      },
      handler: async function (args) {
        // Switch to edit mode if not already (find Edit button by text)
        if (!document.querySelector('textarea')) {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Edit') { btns[i].click(); break; }
          }
          await new Promise(function (r) { setTimeout(r, 500); });
        }

        var textarea = document.querySelector('textarea');
        if (!textarea) return { error: 'Could not find editor textarea' };

        setNativeValue(textarea, args.content);
        return { success: true, message: 'Document content updated' };
      },
    },

    replaceText: {
      description: 'Find and replace text in the currently open document.',
      parameters: {
        find: { type: 'string', description: 'Text to find', required: true },
        replace: { type: 'string', description: 'Replacement text', required: true },
        all: { type: 'boolean', description: 'Replace all occurrences (default: true)' },
      },
      handler: async function (args) {
        // Switch to edit mode if needed
        if (!document.querySelector('textarea')) {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Edit') { btns[i].click(); break; }
          }
          await new Promise(function (r) { setTimeout(r, 500); });
        }

        var textarea = document.querySelector('textarea');
        if (!textarea) return { error: 'Could not find editor textarea' };

        var current = textarea.value;
        var replaceAll = args.all !== false;
        var updated = replaceAll
          ? current.split(args.find).join(args.replace)
          : current.replace(args.find, args.replace);

        if (updated === current) return { success: false, message: 'Text "' + args.find + '" not found in document' };

        setNativeValue(textarea, updated);
        var count = (current.split(args.find).length - 1);
        return { success: true, message: 'Replaced ' + (replaceAll ? count + ' occurrence(s)' : '1 occurrence') };
      },
    },

    appendToDocument: {
      description: 'Append text to the end of the currently open document.',
      parameters: {
        text: { type: 'string', description: 'Text to append', required: true },
      },
      handler: async function (args) {
        // Switch to edit mode if needed
        if (!document.querySelector('textarea')) {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Edit') { btns[i].click(); break; }
          }
          await new Promise(function (r) { setTimeout(r, 500); });
        }

        var textarea = document.querySelector('textarea');
        if (!textarea) return { error: 'Could not find editor textarea' };

        var current = textarea.value;
        var newContent = current + (current.endsWith('\n') ? '' : '\n') + args.text;
        setNativeValue(textarea, newContent);
        return { success: true, message: 'Text appended to document' };
      },
    },

    openFile: {
      description: 'Open a file or folder from the file browser by name.',
      parameters: {
        name: { type: 'string', description: 'File name or partial name to match', required: true },
      },
      handler: async function (args) {
        var mainEl = document.querySelector('main');
        if (!mainEl) return { error: 'File browser not found' };

        var candidates = mainEl.querySelectorAll('[class*="cursor-pointer"]');
        for (var i = 0; i < candidates.length; i++) {
          var nameEl = candidates[i].querySelector('.truncate');
          var nameText = nameEl ? nameEl.textContent.trim().toLowerCase() : candidates[i].textContent.trim().toLowerCase();
          if (nameText.includes(args.name.toLowerCase())) {
            candidates[i].click();
            return { success: true, message: 'Opened: ' + (nameEl ? nameEl.textContent.trim() : candidates[i].textContent.trim().substring(0, 60)) };
          }
        }
        return { error: 'File "' + args.name + '" not found in file browser' };
      },
    },
  };

  // ── Tasks Functions (/tools/tasks) ──

  var tasksFunctions = {
    searchTasks: {
      description: 'Search tasks by typing a query into the search field.',
      parameters: {
        query: { type: 'string', description: 'Search query text', required: true },
      },
      handler: async function (args) {
        var searchInput = document.querySelector(
          'input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]'
        );
        if (!searchInput) return { error: 'Could not find search input' };

        setNativeValue(searchInput, args.query);
        await new Promise(function (r) { setTimeout(r, 300); });
        return { success: true, message: 'Searched for: ' + args.query };
      },
    },
  };

  // ── Routing ──

  function updateFunctions() {
    var path = window.location.pathname;
    var functions = {};

    Object.keys(globalFunctions).forEach(function (key) {
      functions[key] = globalFunctions[key];
    });

    if (path.startsWith('/tools/files/viewer')) {
      Object.keys(fileViewerFunctions).forEach(function (key) {
        functions[key] = fileViewerFunctions[key];
      });
    }
    if (path.startsWith('/tools/tasks')) {
      Object.keys(tasksFunctions).forEach(function (key) {
        functions[key] = tasksFunctions[key];
      });
    }

    window.nbt_functions = functions;
    window.dispatchEvent(new CustomEvent('voxglide:functions-changed'));
  }

  // ── SPA Navigation Detection ──

  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;

  history.pushState = function () {
    origPushState.apply(this, arguments);
    updateFunctions();
  };
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    updateFunctions();
  };
  window.addEventListener('popstate', updateFunctions);

  // ── Initialize ──
  updateFunctions();
})();
