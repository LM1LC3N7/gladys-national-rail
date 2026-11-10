import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DarwinError, boardUrl, faultCode, fetchBoard, retryAfterSeconds } from '../src/darwin.js';
import { DEFAULT_API_URL, MAX_BODY_BYTES } from '../src/constants.js';
import { KEY, board, fault, json } from './helpers/world.js';

const BOARD = { from: 'RDG', to: 'PAD' };
const call = (respond, options = {}) => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return respond(url, init);
  };
  const run = fetchBoard(
    {
      apiUrl: DEFAULT_API_URL,
      apiKey: KEY,
      version: '0.1.0',
      fetchImpl,
      timeoutMs: 100,
      ...options,
    },
    BOARD,
  );
  return { run, seen };
};
const codeOf = async (promise) => {
  try {
    await promise;
    return 'resolved';
  } catch (err) {
    assert.ok(err instanceof DarwinError, String(err));
    assert.ok(!err.message.includes(KEY), 'the key in an error');
    return err.code;
  }
};

test('the request: the board URL, the key in x-apikey, JSON asked, the own User-Agent, no redirect', async () => {
  const { run, seen } = call(() => json(board()));
  const { json: body } = await run;
  assert.equal(body.locationName, 'London Paddington');
  const { url, init } = seen[0];
  assert.equal(
    url,
    `${DEFAULT_API_URL}/GetDepBoardWithDetails/RDG?numRows=10&timeWindow=120&timeOffset=0&filterCrs=PAD&filterType=to`,
  );
  assert.ok(!url.includes(KEY));
  assert.equal(init.headers['x-apikey'], KEY);
  assert.equal(init.headers.accept, 'application/json');
  assert.equal(
    init.headers['user-agent'],
    'gladys-national-rail/0.1.0 (+https://github.com/LM1LC3N7/gladys-national-rail)',
  );
  assert.equal(init.redirect, 'error');
  assert.equal(boardUrl(DEFAULT_API_URL, { from: 'PAD', to: null }).includes('filterCrs'), false);
});

test('401/403: refused only with the fault of the gateway; unreadable otherwise', async () => {
  assert.equal(await codeOf(call(() => fault(401)).run), 'refused');
  assert.equal(
    await codeOf(call(() => fault(403, 'keymanagement.service.app_not_approved')).run),
    'refused',
  );
  assert.equal(
    await codeOf(call(() => new Response('<html>denied</html>', { status: 403 })).run),
    'unreadable',
  );
  assert.equal(
    await codeOf(call(() => json({ fault: { detail: { errorcode: 'bad code!' } } }, 401)).run),
    'unreadable',
  );
  assert.equal(
    await codeOf(call(() => new Response('{"fault":', { status: 401 })).run),
    'unreadable',
  );
  assert.equal(
    faultCode({ fault: { detail: { errorcode: 'oauth.v2.InvalidApiKey' } } }),
    'oauth.v2.InvalidApiKey',
  );
});

test('429 with Retry-After (seconds, or a date against the Date header); 400/404; 5xx; other', async () => {
  const limited = call(() => json({}, 429, { 'retry-after': '120' }));
  await assert.rejects(limited.run, (err) => err.code === 'rate_limited' && err.retryAfter === 120);
  assert.equal(
    retryAfterSeconds('Tue, 10 Nov 2026 18:05:00 GMT', 'Tue, 10 Nov 2026 18:00:00 GMT'),
    300,
  );
  assert.equal(retryAfterSeconds('Tue, 10 Nov 2026 18:05:00 GMT', null), null);
  assert.equal(retryAfterSeconds('soon', 'x'), null);
  assert.equal(retryAfterSeconds(undefined), null);
  assert.equal(await codeOf(call(() => json({}, 400)).run), 'bad_request');
  assert.equal(await codeOf(call(() => json({}, 404)).run), 'bad_request');
  assert.equal(await codeOf(call(() => json({}, 503)).run), 'server');
  assert.equal(await codeOf(call(() => json({}, 302)).run), 'unreadable');
  assert.equal(
    await codeOf(call(() => new Response('not json', { status: 200 })).run),
    'unreadable',
  );
  assert.equal(await codeOf(call(() => json([1, 2])).run), 'unreadable');
});

test('a body too large is cut before it is read in full (declared or streamed)', async () => {
  const declared = call(
    () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      }),
  );
  assert.equal(await codeOf(declared.run), 'too_large');
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
      if (pulled > 1000) controller.close();
    },
  });
  assert.equal(await codeOf(call(() => new Response(stream, { status: 200 })).run), 'too_large');
  assert.ok(pulled < 40, `${pulled} chunks pulled`);
});

test('no answer: timeout; network error; never the key in the message', async (t) => {
  // AbortSignal.timeout does not keep the event loop alive (Node 22): a timer does.
  const alive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(alive));
  const hung = call(
    (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      ),
  );
  assert.equal(await codeOf(hung.run), 'timeout');
  const refused = call(() => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  });
  assert.equal(await codeOf(refused.run), 'network');
  // A body that stalls after the headers: cut by the same deadline.
  const stalled = call(
    (_, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"a":'));
            init.signal.addEventListener('abort', () =>
              controller.error(new DOMException('aborted', 'AbortError')),
            );
          },
        }),
        { status: 200 },
      ),
  );
  assert.equal(await codeOf(stalled.run), 'timeout');
});
