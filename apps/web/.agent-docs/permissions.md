# Authorization

## Model

The web app uses authorization capabilities from the server for presentation and navigation, while the API worker remains the source of truth for real allow or deny decisions.

## Rules

- Use the capabilities endpoint and `useAuthorization()` for nav visibility, page-level guards, and broad action visibility.
- Do not treat a capability like `user:update` as proof that the current user can update every record. Ownership, org scope, and relationships still need server checks.
- Keep denial UX specific to the situation. A user blocked from an entire area should not see the same message as a user blocked from one record-level action.
- Keep server-side authorization in route middleware and resource policies. The browser only reflects likely availability.

## References

- [Authorization package guide](../../../packages/authorization/README.md)
- [Authorization quick start](../../../packages/authorization/docs/quick-start.md)
