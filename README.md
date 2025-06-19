# Repomix MCP Server

A Model Context Protocol (MCP) server that provides access to the [repomix](https://github.com/yamadashy/repomix) tool for packing repositories into AI-friendly files.

## Security

- **Input paths**: The server restricts file access to the directory from which it was started. Any attempts to access files outside this directory (like `/etc/`) will be denied.
- **Output files**: All output is written to the system's temporary directory and automatically cleaned up after the contents are returned.
- **Remote URLs**: Remote repository URLs are still allowed for processing.

## Installation

```bash
npm install
npm run build
```

## Usage

### Claude Code

```bash
claude mcp add --scope user repomix node /path/to/repomix-mcp/dist/index.js
```

### Claude Desktop

Add this server to your MCP client configuration in your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "repomix": {
      "command": "node",
      "args": ["/path/to/repomix-mcp/dist/index.js"]
    }
  }
}
```

## Available Tools

Both tools accept the same parameters:

### Parameters

| Parameter | Type | Required | Description | Examples |
|-----------|------|----------|-------------|----------|
| `path` | string | No | Directory path to pack | `/path/to/repo` |
| `style` | enum | No | Output format style | `xml`, `markdown`, `plain` |
| `compress` | boolean | No | Compress output to reduce token count | `true`, `false` |
| `include` | string | No | Files to include (glob pattern) | `*.md,*.ts,*.js`, `*.py`, `src/**/*.go` |
| `ignore` | string | No | Files to exclude (glob pattern) | `*test*,*spec*,dist/**,build/**` |
| `remote` | string | No | Remote repository URL to process | `https://github.com/user/repo` |

### repomix-estimate

Estimate the size of [repomix](https://github.com/yamadashy/repomix) output without retrieving the content. Use this first to check if the output will fit in your context window.

Returns:
- File size in KB/MB
- Estimated token count (~4 characters per token)
- Whether compression is enabled

#### repomix-estimate output

```
Repomix output size estimate:
- Size: 5.27 KB (0.01 MB)
- Estimated tokens: ~1,349
- Compression: disabled

Use the repomix tool with these same parameters to retrieve the actual content.
```

### repomix

Pack a repository into a single, AI-friendly file. Returns the contents of the generated file.

**Best Practice**: Always use `repomix-estimate` first to check the output size, then use `repomix` with appropriate parameters (especially `compress=true` for large repos).

Example usage in Claude:
1. First check size: `use repomix-estimate tool`
2. If size is reasonable: `use repomix tool`
3. If too large, try with compression: `use repomix-estimate tool with compress=true`
4. Then retrieve: `use repomix tool with compress=true`

**Workflow**: Always estimate first, then retrieve only if the size fits your needs.

#### repomix output (first 15 lines)

```xml
This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.

<file_summary>
This section contains a summary of this file.

<purpose>
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.
</purpose>

<file_format>
The content is organized as follows:
1. This summary section
2. Repository information
```
