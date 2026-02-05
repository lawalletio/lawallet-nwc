# Testing Strategy

## Testing Pyramid

| Layer | Tool | Scope | Target Coverage |
|-------|------|-------|-----------------|
| Unit | Vitest | Hooks, utilities, SDK methods | 80% |
| Component | React Testing Library + Vitest | UI components, hooks integration | 70% |
| API | MSW + Vitest | API routes, middleware, auth | 90% |
| Integration | Vitest + Prisma test utils | DB ops, NWC flows, redirect resolution | 70% |
| E2E | Playwright | Multi-browser flows, visual regression | Critical paths |
| Coverage | Vitest Coverage (c8/v8) | Overall codebase | 70% minimum |

---

## Unit Testing (Vitest)

- Primary test runner for all unit and integration tests
- React Testing Library with happy-dom environment
- Coverage reporting via c8/v8
- Target: 80% on hooks and utilities

---

## Component Testing (React Testing Library + Vitest)

- Test UI components in isolation
- Verify hook integration with components
- Test user interactions and state changes
- Target: 70% on component library

---

## API Testing (MSW)

- Mock Service Worker for API route mocking
- Test NWC connection, lightning address, auth endpoints
- Simulate payment callbacks
- Test error handling and edge cases
- Target: 90% on API routes

---

## Integration Testing (Prisma Test Utils)

- Isolated test database per test suite
- Seeding scripts for reproducible test data
- Transaction rollback between tests
- Test NWC flows, alias/redirect resolution, address lifecycle
- Target: 70% on integration paths

---

## E2E Testing (Playwright)

### Multi-browser

- Chrome, Firefox, Safari
- Run against reimplemented components from month 3 onward
- Visual regression baselines and updates

### Timeline

| Month | Scope |
|-------|-------|
| 3 | Multi-browser smoke tests, visual regression baseline, admin dashboard flows, alias setup |
| 4 | User dashboard, profile/npub setup, redirect/NWC flows, visual regression updates |
| 5 | Lightning compliance flows, webhook delivery, redirect resolution |
| 6 | Deployment smoke tests, full regression across all 3 services |

---

## CI/CD Integration

- GitHub Actions workflow: lint → typecheck → test
- PR status checks required for merge
- Branch protection on main
- Coverage upload to Codecov
- Automated build verification on push
