// 文件系统工具 schema：read_file / list_dir / write_file / delete_file / make_dir
export const filesystemSchemas = {
  read_file: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. This is the correct way to read a file — do NOT shell out through exec_command (Get-Content / cat / type), which risks encoding garble. Accepts a relative path (inside the sandbox) or an absolute path such as D:\\notes\\a.txt when the file sandbox is disabled. Use start_line/end_line/max_lines when the user asks for a limited range such as "first 120 lines"; do not read the whole file when a range is enough.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative file path.'
          },
          start_line: {
            type: 'number',
            description: 'Optional 1-based first line to read.'
          },
          end_line: {
            type: 'number',
            description: 'Optional 1-based last line to read, inclusive.'
          },
          max_lines: {
            type: 'number',
            description: 'Optional maximum number of lines to return, starting from start_line or line 1.'
          }
        },
        required: ['path']
      }
    }
  },

  list_dir: {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders under a directory. Prefer this over shelling out through exec_command (Get-ChildItem / ls / dir). Accepts a relative path (inside the sandbox) or an absolute path such as D:\\projects when the file sandbox is disabled.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path, defaults to the current directory.'
          }
        },
        required: []
      }
    }
  },

  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to the specified file. This is the ONLY correct way to create or overwrite a text file (HTML, code, JSON, markdown, scripts, any multi-line content). Pass the full file body verbatim in `content` — no escaping, no quoting, no here-strings. Creates the file and any missing parent directories automatically, then reads the file back to verify the bytes landed. Accepts a relative path (inside the sandbox) or an absolute path such as D:\\desktop\\page.html when the file sandbox is disabled. NEVER build a file by shelling out through exec_command (e.g. PowerShell [System.IO.File]::WriteAllText / Out-File / Set-Content / echo >, or python -c with embedded content): those break on quotes, $, backticks and triple-quotes and waste turns. If you need the file somewhere specific on disk, give that absolute path here directly.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path.'
          },
          content: {
            type: 'string',
            description: 'Content to write.'
          }
        },
        required: ['path', 'content']
      }
    }
  },

  delete_file: {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file or directory. This is the correct way to delete — do NOT shell out through exec_command (Remove-Item / rm / del), which skips the read-back confirmation and the protection on system files. Directories are removed recursively. System files such as readme.txt and world.txt cannot be deleted. Accepts a relative path (inside the sandbox) or an absolute path when the file sandbox is disabled.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File or directory path to delete. Relative paths resolve inside the sandbox; an absolute path is allowed when the file sandbox is disabled.' }
        },
        required: ['path']
      }
    }
  },

  make_dir: {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Create a directory. Prefer this over shelling out through exec_command (New-Item / mkdir). Nested paths such as projects/myapp/src are created in one call. Accepts a relative path (inside the sandbox) or an absolute path when the file sandbox is disabled. (write_file already creates parent directories on its own, so you rarely need this just to prepare a file path.)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create.' }
        },
        required: ['path']
      }
    }
  },
}
