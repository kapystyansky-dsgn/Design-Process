/**
 * MCP server for Design Process — Figma structure tools
 * Использует тот же FIGMA_ACCESS_TOKEN, что и HTTP endpoints
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod');

const FIGMA_API = 'https://api.figma.com/v1';
const BASE_KNOWLEDGE_FILE = 'dILPO7rdRMS7JXaeOwvVEJ';
const BASE_KNOWLEDGE_NODE = '802-11234';
const TOOLS_FILE = 'zhBJGwSZKLdIUG2F3IJSNQ';
const TOOLS_NODE = '861-11829';

function nodeIdFromUrl(id) {
  if (typeof id !== 'string') return id;
  return id.replace(/-/g, ':');
}

async function fetchFigmaNodes(accessToken, fileKey, nodeId) {
  const ids = nodeIdFromUrl(nodeId);
  const url = `${FIGMA_API}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
  const response = await fetch(url, {
    headers: { 'X-Figma-Token': accessToken },
  });
  const data = await response.json();
  if (data.err) {
    throw new Error(data.message || data.err || 'Figma API error');
  }
  return data;
}

function createMcpServer(figmaToken) {
  const server = new McpServer(
    {
      name: 'design-process-figma',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    'get_file_structure',
    {
      description: 'Получить структуру страницы из Figma «База знаний» (шаблон для «Создать структуру файла»). Возвращает имена фреймов и структуру узла.',
      inputSchema: {
        fileKey: z.string().optional().default(BASE_KNOWLEDGE_FILE).describe('Figma file key'),
        nodeId: z.string().optional().default(BASE_KNOWLEDGE_NODE).describe('Node ID (format: 802-11234)'),
      },
    },
    async ({ fileKey, nodeId }) => {
      if (!figmaToken) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                fallback: true,
                error: 'FIGMA_ACCESS_TOKEN not configured. Set it in proxy/.env',
              }),
            },
          ],
        };
      }
      try {
        const data = await fetchFigmaNodes(figmaToken, fileKey, nodeId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: err.message,
                fallback: true,
              }),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    'get_metadata_structure',
    {
      description: 'Получить структуру компонентов из Figma «Tools» (шаблон для «Добавить метаданные»).',
      inputSchema: {
        fileKey: z.string().optional().default(TOOLS_FILE).describe('Figma file key'),
        nodeId: z.string().optional().default(TOOLS_NODE).describe('Node ID'),
      },
    },
    async ({ fileKey, nodeId }) => {
      if (!figmaToken) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                fallback: true,
                error: 'FIGMA_ACCESS_TOKEN not configured. Set it in proxy/.env',
              }),
            },
          ],
        };
      }
      try {
        const data = await fetchFigmaNodes(figmaToken, fileKey, nodeId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: err.message,
                fallback: true,
              }),
            },
          ],
        };
      }
    }
  );

  return server;
}

module.exports = { createMcpServer };
