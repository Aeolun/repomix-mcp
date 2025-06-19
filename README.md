# Repomix MCP Server

A Model Context Protocol (MCP) server that provides access to the repomix tool for packing repositories into AI-friendly files.

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

Add this server to your MCP client configuration. For Claude Desktop, add to your `claude_desktop_config.json`:

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

### repomix-estimate

Estimate the size of repomix output without retrieving the content. Use this first to check if the output will fit in your context window.

Parameters: Same as `repomix` tool

Returns:
- File size in KB/MB
- Estimated token count
- Whether compression is enabled

### repomix

Pack a repository into a single, AI-friendly file. Returns the contents of the generated file.

**Best Practice**: Always use `repomix-estimate` first to check the output size, then use `repomix` with appropriate parameters (especially `compress=true` for large repos).

Parameters:
- `path` (optional): Directory path to pack
- `style` (optional): Output format - "xml", "markdown", or "plain"
- `compress` (optional): Compress output to reduce tokens
- `include` (optional): Files to include (glob pattern)
- `ignore` (optional): Files to exclude (glob pattern)
- `remote` (optional): Remote repository URL

Example usage in Claude:
1. First check size: `use repomix-estimate tool`
2. If size is reasonable: `use repomix tool`
3. If too large, try with compression: `use repomix-estimate tool with compress=true`
4. Then retrieve: `use repomix tool with compress=true`

**Workflow**: Always estimate first, then retrieve only if the size fits your needs.