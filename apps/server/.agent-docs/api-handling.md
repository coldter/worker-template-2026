# API Handling

- Define contracts in `routes.ts` via `createRouteConfig`.
- Declare route guards with the `guard` field in `createRouteConfig`; pass either a middleware or middleware array.
- Read validated input only through `c.req.valid("json" | "query" | "param")`.
- Return explicit status codes (`c.json(payload, 200)`).
- Map domain failures to `HTTPException` with clear status/message.
