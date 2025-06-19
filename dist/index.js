#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const zod_1 = require("zod");
const child_process_1 = require("child_process");
const util_1 = require("util");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const os_1 = require("os");
const crypto_1 = require("crypto");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const RepomixArgsSchema = zod_1.z.object({
    path: zod_1.z.string().optional().describe('Path to the directory to pack'),
    style: zod_1.z.enum(['xml', 'markdown', 'plain']).optional().describe('Output format style'),
    compress: zod_1.z.boolean().optional().describe('Compress output to reduce token count'),
    include: zod_1.z.string().optional().describe('Files to include (glob pattern)'),
    ignore: zod_1.z.string().optional().describe('Files to exclude (glob pattern)'),
    remote: zod_1.z.string().optional().describe('Remote repository URL to process'),
});
class RepomixMCPServer {
    server;
    allowedDirectory;
    constructor() {
        // Get the working directory from where the server was started
        this.allowedDirectory = process.cwd();
        this.server = new index_js_1.Server({
            name: 'repomix-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupHandlers();
        // Log the allowed directory for debugging
        console.error(`Repomix MCP server: Restricting access to directory: ${this.allowedDirectory}`);
    }
    async isPathAllowed(targetPath) {
        try {
            // Resolve the absolute path
            const absolutePath = await (0, promises_1.realpath)((0, path_1.resolve)(targetPath));
            const allowedPath = await (0, promises_1.realpath)(this.allowedDirectory);
            // Check if the target path is within the allowed directory
            const relativePath = (0, path_1.relative)(allowedPath, absolutePath);
            // If the relative path starts with '..', it's outside the allowed directory
            return !relativePath.startsWith('..') && !relativePath.startsWith('/');
        }
        catch {
            // If we can't resolve the path, it's probably invalid
            return false;
        }
    }
    setupHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'repomix',
                    description: 'Pack a repository into a single AI-friendly file. Best used at the beginning of a session to get a comprehensive overview of the codebase. Warning: Output can be very large - consider using repomix-estimate first to check the size.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to the directory to pack'
                            },
                            style: {
                                type: 'string',
                                enum: ['xml', 'markdown', 'plain'],
                                description: 'Output format style'
                            },
                            compress: {
                                type: 'boolean',
                                description: 'Compress output to reduce token count'
                            },
                            include: {
                                type: 'string',
                                description: 'Files to include (glob pattern)'
                            },
                            ignore: {
                                type: 'string',
                                description: 'Files to exclude (glob pattern)'
                            },
                            remote: {
                                type: 'string',
                                description: 'Remote repository URL to process'
                            }
                        }
                    },
                },
                {
                    name: 'repomix-estimate',
                    description: 'Estimate the size of repomix output without actually retrieving it. Use this before calling repomix to check if the output will be too large.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to the directory to pack'
                            },
                            style: {
                                type: 'string',
                                enum: ['xml', 'markdown', 'plain'],
                                description: 'Output format style'
                            },
                            compress: {
                                type: 'boolean',
                                description: 'Compress output to reduce token count'
                            },
                            include: {
                                type: 'string',
                                description: 'Files to include (glob pattern)'
                            },
                            ignore: {
                                type: 'string',
                                description: 'Files to exclude (glob pattern)'
                            },
                            remote: {
                                type: 'string',
                                description: 'Remote repository URL to process'
                            }
                        }
                    },
                },
            ],
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            if (request.params.name !== 'repomix' && request.params.name !== 'repomix-estimate') {
                throw new Error(`Unknown tool: ${request.params.name}`);
            }
            const args = RepomixArgsSchema.parse(request.params.arguments);
            const isEstimate = request.params.name === 'repomix-estimate';
            // Security check for local paths
            if (args.path && !args.remote) {
                const targetPath = (0, path_1.resolve)(args.path);
                if (!await this.isPathAllowed(targetPath)) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Access denied: Path "${args.path}" is outside the allowed directory (${this.allowedDirectory})`,
                            },
                        ],
                        isError: true,
                    };
                }
            }
            const commandParts = ['npx', 'repomix'];
            if (args.path) {
                commandParts.push(args.path);
            }
            if (args.style) {
                commandParts.push('--style', args.style);
            }
            if (args.compress) {
                commandParts.push('--compress');
            }
            if (args.include) {
                commandParts.push('--include', `"${args.include}"`);
            }
            if (args.ignore) {
                commandParts.push('--ignore', `"${args.ignore}"`);
            }
            if (args.remote) {
                commandParts.push('--remote', args.remote);
            }
            // Always use a temporary output file
            const tempFileName = `repomix-${(0, crypto_1.randomBytes)(8).toString('hex')}.txt`;
            const tempFilePath = (0, path_1.join)((0, os_1.tmpdir)(), tempFileName);
            commandParts.push('--output', tempFilePath);
            const command = commandParts.join(' ');
            let stderr = '';
            try {
                // Execute repomix
                const result = await execAsync(command);
                stderr = result.stderr;
                // Read the generated file contents or just get size
                if (isEstimate) {
                    try {
                        const stats = await (0, promises_1.stat)(tempFilePath);
                        const sizeInBytes = stats.size;
                        const sizeInKB = (sizeInBytes / 1024).toFixed(2);
                        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
                        const estimatedTokens = Math.ceil(sizeInBytes / 4); // Rough estimate: ~4 chars per token
                        // Clean up temp file
                        try {
                            await (0, promises_1.rm)(tempFilePath, { force: true });
                        }
                        catch {
                            // Ignore cleanup errors
                        }
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `Repomix output size estimate:\n- Size: ${sizeInKB} KB (${sizeInMB} MB)\n- Estimated tokens: ~${estimatedTokens.toLocaleString()}\n- Compression: ${args.compress ? 'enabled' : 'disabled'}\n\nUse the repomix tool with these same parameters to retrieve the actual content.`,
                                },
                            ],
                        };
                    }
                    catch (error) {
                        // Clean up on error
                        try {
                            await (0, promises_1.rm)(tempFilePath, { force: true });
                        }
                        catch {
                            // Ignore cleanup errors
                        }
                        throw new Error(`Failed to estimate size: ${error.message}${stderr ? `\nRepomix stderr: ${stderr}` : ''}`);
                    }
                }
                else {
                    // Normal repomix - read full contents
                    let fileContents;
                    try {
                        fileContents = await (0, promises_1.readFile)(tempFilePath, 'utf-8');
                    }
                    catch (readError) {
                        // If we can't read the file, include stderr in the error message
                        throw new Error(`Failed to read output file: ${readError.message}${stderr ? `\nRepomix stderr: ${stderr}` : ''}`);
                    }
                    // Clean up temp file
                    try {
                        await (0, promises_1.rm)(tempFilePath, { force: true });
                    }
                    catch {
                        // Ignore cleanup errors
                    }
                    return {
                        content: [
                            {
                                type: 'text',
                                text: fileContents,
                            },
                        ],
                    };
                }
            }
            catch (error) {
                // Clean up temp file on error
                try {
                    await (0, promises_1.rm)(tempFilePath, { force: true });
                }
                catch {
                    // Ignore cleanup errors
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error executing repomix: ${error.message}${stderr ? `\nStderr: ${stderr}` : ''}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error('Repomix MCP server running on stdio');
    }
}
const server = new RepomixMCPServer();
server.run().catch(console.error);
