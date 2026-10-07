# Shared game core

`types.ts` defines serializable `Room` / `GameState` and opaque player IDs.
`protocol.ts` defines both directions of the existing protocol, Socket.IO handler
types, and the public room snapshot (including legacy `words`, excluding passwords).
`validation.ts` validates auth payloads, names, health IDs, item configuration and
client event payloads. `rateLimits.ts` owns common event budget settings.

`game.ts` exports `applyGameEvent(state, event, context)`. It returns a new state
and ordered effects: protocol broadcasts and game activities. It does not mutate
its input, access a database, use a transport or create a timer. The runtime
supplies the clock, entropy and generated game ID. DB loaders still live in
`server/src/lib/get.ts` and `cloudflare/src/lib/services.ts`; they pass the refreshed
game duration into the core at start. There is no repository interface because
these adapters do not need interchangeable database implementations yet.

## Runtime boundaries

- Node: `server/src/lib/gameAdapter.ts` holds state and a private `setTimeout`
  handle; `server/src/index.ts` handles Socket.IO, authentication, PostgreSQL,
  room lifecycle, logs and analytics. Async configuration reads recheck the
  current adapter and start eligibility before applying an event.
- Worker: `cloudflare/src/index.ts` handles Native WebSocket, authentication,
  Supabase reads, DO Storage, hibernation and session expiry. It serializes game
  operations, saves transitions before publishing effects, and schedules the
  earliest game/session deadline through DO Alarm.
- Rate-limit bucket storage, unknown-event handling and health-probe scope remain
  runtime-specific (Node addresses vs Worker health DO).

`wordAt` and `bombAt` are absolute epoch-millisecond deadlines at the top level of
`GameState`, preserving the existing Worker storage shape. `nextGameDeadline`
selects the earliest deadline; `deadline` consumes due events and schedules the
next bomb phase from the supplied current time. Bomb phases remain 0–4, with
explosion on the following deadline. The countdown remains 3 seconds and each
bomb phase lasts configured duration + random 0–10 seconds. Late execution advances
one bomb phase, matching the existing behavior.

Existing differences are explicit in the runtime configuration:
`NODE_GAME_RULES` in the Node adapter and `WORKER_GAME_RULES` in
`cloudflare/src/lib/gameRules.ts`:
Node permits spectator starts and holder passes during countdown; Worker rejects
both. Worker clears typing input when stopping; Node retains its existing stop
notification behavior. These settings preserve compatibility and can be unified
later as an intentional rules change.

## Future extensions

For `playerSessionId`, resolve transport/session IDs to a stable `playerId` in each
runtime before constructing core events, and use that ID in `Room.users`. The core
requires no Socket.IO or WebSocket changes. Stable reconnect membership and JWT
identity policy belong in the runtime authentication/session adapters.

For sticky ownership or failover, add ownership and synchronization around runtime
state loading/saving. Transfer the serializable `GameState`, keep `gameId` and
absolute deadlines, then reschedule with the receiving runtime. Ownership epochs,
effect deduplication and fencing are future adapter responsibilities; this change
does not implement failover or cross-server synchronization.

## Verification and builds

- `cd server && npm test`: shared unit tests, Node timer tests and existing tests.
- `cd server && npm run build`: compiles Node and its imported shared sources.
  A generated `server/dist/index.js` entry loads `dist/server/src/index.js`, with
  shared code at `server/dist/shared/`. The existing compiled entry path and
  `npm start` / `npm run dev` keep working.
  Deploy the complete `dist` directory when using compiled JavaScript.
- `cd cloudflare && npm test`: Worker integration tests, including a scenario that
  applies the same events through the real GameRoom adapter and NodeGameAdapter
  and compares persisted states after every event.
- `cd cloudflare && npm run typecheck && npm run build`: typecheck and Wrangler
  dry-run bundle (no deployment). Wrangler bundles imported shared sources.

Keep the repository's `shared/` directory beside `server/` and `cloudflare/` when
running or building from source; shared code adds no dependencies or install step.
