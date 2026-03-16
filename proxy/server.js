require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN || '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const FIGMA_API = 'https://api.figma.com/v1';
const ALLOWED_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY not set. Set it via environment variable.');
}
if (!FIGMA_ACCESS_TOKEN) {
  console.warn('WARNING: FIGMA_ACCESS_TOKEN not set. Figma file/structure endpoints will return fallback.');
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '20mb' }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Подождите минуту.' },
});
app.use('/v1/', limiter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    gemini: !!GEMINI_API_KEY,
    figma: !!FIGMA_ACCESS_TOKEN,
    models: ALLOWED_MODELS,
  });
});

app.post('/v1/generate', async (req, res) => {
  try {
    const { contents, generationConfig, model } = req.body;

    const key = GEMINI_API_KEY;
    if (!key) {
      return res.status(500).json({ error: 'GEMINI_API_KEY не настроен на сервере.' });
    }

    if (!contents || !Array.isArray(contents)) {
      return res.status(400).json({ error: 'Missing or invalid contents field.' });
    }

    const modelName = (model && ALLOWED_MODELS.includes(model)) ? model : ALLOWED_MODELS[0];
    const url = GEMINI_BASE + modelName + ':generateContent?key=' + key;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig }),
    });

    const data = await response.text();
    res.status(response.status).set('Content-Type', 'application/json').send(data);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error: ' + (err.message || String(err)) });
  }
});

// --- Figma file nodes (for structure / metadata) ---
function nodeIdFromUrl(id) {
  if (typeof id !== 'string') return id;
  return id.replace(/-/g, ':');
}

app.get('/file-structure', async (req, res) => {
  try {
    const { fileKey, nodeId } = req.query;
    if (!fileKey || !nodeId) {
      return res.status(400).json({ error: 'fileKey and nodeId required' });
    }
    if (!FIGMA_ACCESS_TOKEN) {
      return res.status(200).json({ fallback: true, error: 'FIGMA_ACCESS_TOKEN not configured' });
    }
    const ids = nodeIdFromUrl(nodeId);
    const url = `${FIGMA_API}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
    const response = await fetch(url, {
      headers: { 'X-Figma-Token': FIGMA_ACCESS_TOKEN },
    });
    const data = await response.json();
    if (data.err) {
      return res.status(400).json({ error: data.message || data.err });
    }
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Figma API error: ' + (err.message || String(err)) });
  }
});

app.get('/metadata-structure', async (req, res) => {
  try {
    const { fileKey, nodeId } = req.query;
    if (!fileKey || !nodeId) {
      return res.status(400).json({ error: 'fileKey and nodeId required' });
    }
    if (!FIGMA_ACCESS_TOKEN) {
      return res.status(200).json({ fallback: true, error: 'FIGMA_ACCESS_TOKEN not configured' });
    }
    const ids = nodeIdFromUrl(nodeId);
    const url = `${FIGMA_API}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
    const response = await fetch(url, {
      headers: { 'X-Figma-Token': FIGMA_ACCESS_TOKEN },
    });
    const data = await response.json();
    if (data.err) {
      return res.status(400).json({ error: data.message || data.err });
    }
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Figma API error: ' + (err.message || String(err)) });
  }
});

// Компоненты: [0]=Cover, [1..]=Метаданные (Tools)
const METADATA_NODE_IDS = ['406-1929', '406-1961', '406-1685', '406-1678', '47-2122'];
const METADATA_TOOLS_FILE = 'zh8JGwSZKLdlUG2F3lJsNQ';

app.get('/metadata-components', async (req, res) => {
  try {
    if (!FIGMA_ACCESS_TOKEN) {
      return res.status(200).json({ fallback: true, error: 'FIGMA_ACCESS_TOKEN not configured', componentKeys: [] });
    }
    const url = `${FIGMA_API}/files/${METADATA_TOOLS_FILE}`;
    const response = await fetch(url, {
      headers: { 'X-Figma-Token': FIGMA_ACCESS_TOKEN },
    });
    const data = await response.json();
    if (data.err) {
      return res.status(400).json({ error: data.message || data.err, componentKeys: [] });
    }
    const componentsMap = data.components || {};
    const targetNodeIds = METADATA_NODE_IDS.map((id) => nodeIdFromUrl(id));
    const byNodeId = {};
    for (const [k, comp] of Object.entries(componentsMap)) {
      if (comp && comp.key) {
        const nid = comp.node_id || k;
        byNodeId[nid] = comp.key;
      }
    }
    const componentKeys = [];
    for (const nodeId of targetNodeIds) {
      const ck = byNodeId[nodeId] || (componentsMap[nodeId] && componentsMap[nodeId].key);
      if (ck) componentKeys.push(ck);
    }
    res.json({ componentKeys, fileKey: METADATA_TOOLS_FILE });
  } catch (err) {
    res.status(502).json({ error: 'Figma API error: ' + (err.message || String(err)), componentKeys: [] });
  }
});

// --- MCP server (Design Process Figma tools) ---
const { createMcpServer } = require('./mcp-server.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

app.post('/mcp', async (req, res) => {
  const server = createMcpServer(FIGMA_ACCESS_TOKEN);
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('MCP error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Design Process proxy running on port ' + PORT);
  console.log('Gemini: ' + (GEMINI_API_KEY ? 'configured' : 'NOT SET'));
  console.log('Figma: ' + (FIGMA_ACCESS_TOKEN ? 'configured' : 'NOT SET'));
  console.log('MCP: http://localhost:' + PORT + '/mcp');
});
