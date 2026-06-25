# Frontend — React + TypeScript + Mantine

Vite-based React SPA with KoboToolbox branding via a custom Mantine 7 theme.

## Key files

| File                       | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `src/main.tsx`             | Entry point: providers (Mantine, TanStack Query, Router) |
| `src/App.tsx`              | Route definitions (react-router-dom v6)              |
| `src/api/client.ts`       | API client: fetch wrapper, CSRF handling, auth methods |
| `src/theme/kobo/index.ts` | Mantine theme overrides (colors, fonts, components)  |
| `src/pages/`              | Route-level page components                          |
| `vite.config.ts`          | Vite config: build output, `/api` proxy to :8000     |
| `biome.json`              | Biome formatter/linter config                        |

## API conventions

- **Base URL**: `/api` (relative — never hardcode `localhost`)
- **CSRF**: `client.ts` reads the `csrftoken` cookie and attaches `X-CSRFToken` header on POST/PUT/DELETE/PATCH
- **Credentials**: Every request uses `credentials: 'include'` for session cookies
- **Error handling**: Non-OK responses throw an `Error` with the server's error message
- Add new API methods to the `api` object in `client.ts`

## Component conventions

- Functional components only (no class components)
- One component per file, named export matching filename
- Prefer Mantine components over raw HTML elements
- Use Mantine style props (`mt`, `p`, `fz`, etc.) for spacing/sizing
- Pages go in `src/pages/`, reusable components in `src/components/`

## State management

- **Server state**: TanStack Query v5 (`useQuery`, `useMutation`)
- **Local UI state**: `useState` / `useReducer`
- No Redux, no Zustand — keep it simple for a POC

## Styling

- Mantine style props for layout and spacing
- CSS Modules (`.module.scss`) for custom styles when needed
- Kobo theme (`src/theme/kobo/`) provides brand colors, typography, and component overrides
- Do not use inline `style={{}}` objects — use Mantine props or CSS Modules

## Formatting & linting (Biome)

| Setting    | Value            |
| ---------- | ---------------- |
| Indent     | 2 spaces         |
| Quotes     | Single           |
| Semicolons | As needed        |
| Line width | 100 chars        |
| Linter     | Recommended rules|

```bash
npx biome check src/        # lint
npx biome format --write src/ # format
```

## Provider stack (in main.tsx)

```
StrictMode
  -> QueryClientProvider
       -> MantineProvider (theme={themeKobo})
            -> BrowserRouter
                 -> App
```
