#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, rm, realpath, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);

const RepomixArgsSchema = z.object({
  path: z.string().optional().describe('Path to the directory to pack'),
  style: z.enum(['xml', 'markdown', 'plain']).optional().describe('Output format style'),
  compress: z.boolean().optional().describe('Compress output to reduce token count'),
  include: z.string().optional().describe('Files to include (glob pattern)'),
  ignore: z.string().optional().describe('Files to exclude (glob pattern)'),
  remote: z.string().optional().describe('Remote repository URL to process'),
});

class RepomixMCPServer {
  private server: Server;
  private allowedDirectory: string;

  constructor() {
    // Get the working directory from where the server was started
    this.allowedDirectory = process.cwd();
    
    this.server = new Server(
      {
        name: 'repomix-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    
    // Log the allowed directory for debugging
    console.error(`Repomix MCP server: Restricting access to directory: ${this.allowedDirectory}`);
  }

  private async isPathAllowed(targetPath: string): Promise<boolean> {
    try {
      // Resolve the absolute path
      const absolutePath = await realpath(resolve(targetPath));
      const allowedPath = await realpath(this.allowedDirectory);
      
      // Check if the target path is within the allowed directory
      const relativePath = relative(allowedPath, absolutePath);
      
      // If the relative path starts with '..', it's outside the allowed directory
      return !relativePath.startsWith('..') && !relativePath.startsWith('/');
    } catch {
      // If we can't resolve the path, it's probably invalid
      return false;
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'repomix',
          description: 'Pack repository files into a single AI-friendly file. Use at session start to load context efficiently. IMPORTANT: Always use the "include" parameter to filter only relevant files (e.g., "*.md,*.ts,*.js" for a TypeScript project, or "*.md,*.py" for Python). Start with root-level *.md files and source files in the language being worked on. Always use repomix-estimate first to check size.',
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
                description: 'Files to include (glob pattern). Examples: "*.md,*.ts,*.js" for TypeScript projects, "*.md,*.py" for Python, "*.md,*.go" for Go. Always specify to avoid large outputs!'
              },
              ignore: {
                type: 'string',
                description: 'Files to exclude (glob pattern). Use to filter out test files, build outputs, etc. Example: "*test*,*spec*,dist/**,build/**"'
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
          description: 'Estimate repomix output size before retrieval. ALWAYS use this first with the "include" parameter to filter only relevant files (e.g., "*.md,*.ts,*.js" for TypeScript, "*.md,*.py" for Python). If estimated tokens are reasonable (<50K), proceed with repomix using the same filters. This helps load the entire relevant context efficiently.',
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
                description: 'Files to include (glob pattern). Examples: "*.md,*.ts,*.js" for TypeScript projects, "*.md,*.py" for Python, "*.md,*.go" for Go. Always specify to avoid large outputs!'
              },
              ignore: {
                type: 'string',
                description: 'Files to exclude (glob pattern). Use to filter out test files, build outputs, etc. Example: "*test*,*spec*,dist/**,build/**"'
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'repomix' && request.params.name !== 'repomix-estimate') {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      const args = RepomixArgsSchema.parse(request.params.arguments);
      const isEstimate = request.params.name === 'repomix-estimate';
      
      // Security check for local paths
      if (args.path && !args.remote) {
        const targetPath = resolve(args.path);
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
      const tempFileName = `repomix-${randomBytes(8).toString('hex')}.txt`;
      const tempFilePath = join(tmpdir(), tempFileName);
      
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
            const stats = await stat(tempFilePath);
            const sizeInBytes = stats.size;
            const sizeInKB = (sizeInBytes / 1024).toFixed(2);
            const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
            const estimatedTokens = Math.ceil(sizeInBytes / 4); // Rough estimate: ~4 chars per token
            
            // Clean up temp file
            try {
              await rm(tempFilePath, { force: true });
            } catch {
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
          } catch (error: any) {
            // Clean up on error
            try {
              await rm(tempFilePath, { force: true });
            } catch {
              // Ignore cleanup errors
            }
            throw new Error(`Failed to estimate size: ${error.message}${stderr ? `\nRepomix stderr: ${stderr}` : ''}`);
          }
        } else {
          // Normal repomix - read full contents
          let fileContents: string;
          try {
            fileContents = await readFile(tempFilePath, 'utf-8');
          } catch (readError: any) {
            // If we can't read the file, include stderr in the error message
            throw new Error(`Failed to read output file: ${readError.message}${stderr ? `\nRepomix stderr: ${stderr}` : ''}`);
          }
          
          // Clean up temp file
          try {
            await rm(tempFilePath, { force: true });
          } catch {
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
      } catch (error: any) {
        // Clean up temp file on error
        try {
          await rm(tempFilePath, { force: true });
        } catch {
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Repomix MCP server running on stdio');
  }
}

const server = new RepomixMCPServer();
server.run().catch(console.error);