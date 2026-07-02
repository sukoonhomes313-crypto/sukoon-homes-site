// Sukoon Homes Cloudflare Worker + MCP Server
// Firebase credentials stored in Cloudflare env vars

// ===== FIREBASE HELPERS (no admin SDK needed - use REST API) =====
async function fbGet(path, env) {
  const token = await getFirebaseToken(env);
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/sukoon-homes/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.json();
}

async function fbQuery(collection, filters, env) {
  const token = await getFirebaseToken(env);
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: filters ? {
        compositeFilter: {
          op: 'AND',
          filters: filters.map(f => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: f.op || 'EQUAL',
              value: typeof f.value === 'number' ? { integerValue: f.value } : { stringValue: f.value }
            }
          }))
        }
      } : undefined,
      limit: 50
    }
  };
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/sukoon-homes/databases/(default)/documents:runQuery`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return res.json();
}

async function fbUpdate(path, fields, env) {
  const token = await getFirebaseToken(env);
  const fsFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') fsFields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fsFields[k] = { booleanValue: v };
    else if (typeof v === 'number') fsFields[k] = { integerValue: v };
  }
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/sukoon-homes/databases/(default)/documents/${path}?${updateMask}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fsFields }) }
  );
  return res.json();
}

// ===== JWT / Firebase Token =====
async function getFirebaseToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    sub: env.FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore'
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const b64 = s => btoa(JSON.stringify(s)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const sigInput = `${b64(header)}.${b64(payload)}`;

  // Import private key
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const pemBody = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
  const jwt = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await tokenRes.json();
  return data.access_token;
}

// ===== FIRESTORE VALUE EXTRACT =====
function fsVal(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue) return (v.arrayValue.values || []).map(fsVal);
  if (v.mapValue) return fsFields(v.mapValue.fields || {});
  return null;
}
function fsFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fsVal(v);
  return out;
}

// ===== MCP TOOLS DEFINITION =====
const MCP_TOOLS = [
  {
    name: 'get_stats',
    description: 'Get Sukoon Homes platform statistics: total rooms, submissions, users',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_rooms',
    description: 'List all approved rooms (daily or long stay)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['daily', 'long', 'all'], description: 'Room type' },
        city: { type: 'string', description: 'Filter by city' }
      }
    }
  },
  {
    name: 'list_submissions',
    description: 'List pending room submissions awaiting approval',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'all'] }
      }
    }
  },
  {
    name: 'approve_room',
    description: 'Approve a room submission and publish it',
    inputSchema: {
      type: 'object',
      required: ['submission_id', 'room_type'],
      properties: {
        submission_id: { type: 'string', description: 'Firestore submission document ID' },
        room_type: { type: 'string', enum: ['daily', 'long'], description: 'Which collection to publish to' }
      }
    }
  },
  {
    name: 'list_reports',
    description: 'List user reports/complaints about landlords',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'resolved', 'all'] }
      }
    }
  },
  {
    name: 'list_chats',
    description: 'List recent chat conversations on the platform',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results (default 20)' } }
    }
  },
  {
    name: 'get_room',
    description: 'Get full details of a specific room',
    inputSchema: {
      type: 'object',
      required: ['room_id', 'room_type'],
      properties: {
        room_id: { type: 'string' },
        room_type: { type: 'string', enum: ['daily', 'long', 'submission'] }
      }
    }
  },
  {
    name: 'delete_room',
    description: 'Delete a room listing',
    inputSchema: {
      type: 'object',
      required: ['room_id', 'room_type'],
      properties: {
        room_id: { type: 'string' },
        room_type: { type: 'string', enum: ['daily', 'long'] }
      }
    }
  }
];

// ===== MCP TOOL EXECUTOR =====
async function executeTool(name, args, env) {
  try {
    if (name === 'get_stats') {
      const [daily, long, subs] = await Promise.all([
        fbQuery('dailyRooms', null, env),
        fbQuery('longRooms', null, env),
        fbQuery('submissions', null, env)
      ]);
      const dc = (daily || []).filter(d => d.document).length;
      const lc = (long || []).filter(d => d.document).length;
      const sc = (subs || []).filter(d => d.document).length;
      return `📊 Sukoon Homes Stats:\n- Daily Rooms: ${dc}\n- Long Stay Rooms: ${lc}\n- Pending Submissions: ${sc}\n- Total Live Rooms: ${dc + lc}`;
    }

    if (name === 'list_rooms') {
      const type = args.type || 'all';
      const results = [];
      if (type === 'daily' || type === 'all') {
        const r = await fbQuery('dailyRooms', null, env);
        (r || []).filter(d => d.document).forEach(d => {
          const f = fsFields(d.document.fields);
          if (!args.city || f.city?.toLowerCase().includes(args.city.toLowerCase())) {
            results.push(`[Daily] ${f.name || 'Unnamed'} — ${f.city || '?'} — SAR ${f.price || '?'}/night — ID: ${d.document.name.split('/').pop()}`);
          }
        });
      }
      if (type === 'long' || type === 'all') {
        const r = await fbQuery('longRooms', null, env);
        (r || []).filter(d => d.document).forEach(d => {
          const f = fsFields(d.document.fields);
          if (!args.city || f.city?.toLowerCase().includes(args.city.toLowerCase())) {
            results.push(`[Long Stay] ${f.name || 'Unnamed'} — ${f.city || '?'} — SAR ${f.price || '?'}/month — ID: ${d.document.name.split('/').pop()}`);
          }
        });
      }
      return results.length ? `🏠 Rooms (${results.length}):\n${results.join('\n')}` : 'No rooms found.';
    }

    if (name === 'list_submissions') {
      const r = await fbQuery('submissions', null, env);
      const docs = (r || []).filter(d => d.document);
      if (!docs.length) return 'No submissions found.';
      const lines = docs.map(d => {
        const f = fsFields(d.document.fields);
        const id = d.document.name.split('/').pop();
        return `⏳ ${f.name || 'Unnamed'} — ${f.city || '?'} — SAR ${f.price || '?'} — Email: ${f.submitterEmail || '?'} — ID: ${id}`;
      });
      return `📋 Submissions (${lines.length}):\n${lines.join('\n')}`;
    }

    if (name === 'approve_room') {
      const { submission_id, room_type } = args;
      // Get submission
      const subData = await fbGet(`submissions/${submission_id}`, env);
      if (!subData.fields) return `❌ Submission ${submission_id} not found.`;
      const f = fsFields(subData.fields);
      const col = room_type === 'long' ? 'longRooms' : 'dailyRooms';
      const slug = (f.name || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();

      // Create in rooms collection
      const token = await getFirebaseToken(env);
      await fetch(
        `https://firestore.googleapis.com/v1/projects/sukoon-homes/databases/(default)/documents/${col}?documentId=${slug}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              ...subData.fields,
              slug: { stringValue: slug },
              published: { booleanValue: true },
              approvedAt: { stringValue: new Date().toISOString() }
            }
          })
        }
      );

      // Delete submission
      await fetch(
        `https://firestore.googleapis.com/v1/projects/sukoon-homes/databases/(default)/documents/submissions/${submission_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );

      return `✅ Room approved and published!\n- Name: ${f.name}\n- City: ${f.city}\n- Collection: ${col}\n- Slug: ${slug}`;
    }

    if (name === 'list_reports') {
      const r = await fbQuery('reports', null, env);
      const docs = (r || []).filter(d => d.document);
      if (!docs.length) return 'No reports found.';
      const lines = docs.map(d => {
        const f = fsFields(d.document.fields);
        const id = d.document.name.split('/').pop();
        return `🚩 ${f.roomName || '?'} — Reporter: ${f.reporterEmail || '?'} — Reason: ${f.reason || '?'} — Status: ${f.status || 'pending'} — ID: ${id}`;
      });
      return `📋 Reports (${lines.length}):\n${lines.join('\n')}`;
    }

    if (name === 'list_chats') {
      const r = await fbQuery('chats', null, env);
      const docs = (r || []).filter(d => d.document).slice(0, args.limit || 20);
      if (!docs.length) return 'No chats found.';
      const lines = docs.map(d => {
        const f = fsFields(d.document.fields);
        return `💬 ${f.roomName || '?'} — Customer: ${f.customerEmail || '?'} — Last: ${f.lastMessage || '...'} — Unread (landlord): ${f.unreadLandlord || 0}`;
      });
      return `💬 Chats (${lines.length}):\n${lines.join('\n')}`;
    }

    if (name === 'get_room') {
      const col = args.room_type === 'long' ? 'longRooms' : args.room_type === 'submission' ? 'submissions' : 'dailyRooms';
      const data = await fbGet(`${col}/${args.room_id}`, env);
      if (!data.fields) return `❌ Room not found.`;
      const f = fsFields(data.fields);
      return `🏠 Room Details:\n${Object.entries(f).map(([k,v]) => `- ${k}: ${JSON.stringify(v)}`).join('\n')}`;
    }

    if (name === 'delete_room') {
      const col = args.room_type === 'long' ? 'longRooms' : 'dailyRooms';
      const token = await getFirebaseToken(env);
      await fetch(
        `https://firestore.googleapis.com/v1/projects/sukoon-homes/databases/(default)/documents/${col}/${args.room_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      return `✅ Room ${args.room_id} deleted from ${col}.`;
    }

    return `❌ Unknown tool: ${name}`;
  } catch (e) {
    return `❌ Error: ${e.message}`;
  }
}

// ===== MCP HANDLER =====
async function handleMCP(request, env) {
  // CORS headers
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = new URL(request.url);
  const path = url.pathname;

  // SSE endpoint for MCP
  if (path === '/mcp' || path === '/mcp/') {
    if (request.method === 'GET') {
      // MCP Initialize via SSE
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const enc = new TextEncoder();

      const send = (data) => writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      // Send server info
      send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      });

      writer.close();
      return new Response(readable, {
        headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const { method, params, id } = body;

      let result;

      if (method === 'initialize') {
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sukoon-homes-mcp', version: '1.0.0' }
        };
      } else if (method === 'tools/list') {
        result = { tools: MCP_TOOLS };
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const content = await executeTool(name, args || {}, env);
        result = {
          content: [{ type: 'text', text: content }]
        };
      } else {
        return new Response(JSON.stringify({
          jsonrpc: '2.0', id,
          error: { code: -32601, message: `Method not found: ${method}` }
        }), { headers: cors });
      }

      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: cors });
    }
  }

  return new Response('Not found', { status: 404 });
}

// ===== MAIN FETCH =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // MCP endpoint
    if (path.startsWith('/mcp')) {
      return handleMCP(request, env);
    }

    // /rooms/slug → room.html?slug=slug
    if (path.startsWith('/rooms/') && path.length > 7) {
      const slug = path.replace('/rooms/', '');
      url.pathname = '/room.html';
      url.searchParams.set('slug', slug);
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    // /room or /room/ → room.html
    if (path === '/room' || path === '/room/') {
      url.pathname = '/room.html';
      return env.ASSETS.fetch(new Request(url.toString(), request));
    }

    // www redirect
    if (url.hostname === 'sukoonhomesksa.com') {
      url.hostname = 'www.sukoonhomesksa.com';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  }
};
