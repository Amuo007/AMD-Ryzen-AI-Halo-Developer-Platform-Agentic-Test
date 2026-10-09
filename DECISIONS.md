# Decisions

## Project Structure
- Use ES modules (`"type": "module"` in package.json) for modern JavaScript features.
- Separate concerns: `lib/` for server logic, `public/` for static assets, `test/` for tests.
- Entry point: `bin/forge.js` parses args and starts the server.

## Server
- Built with `node:http` only.
- Serves static files from `./public` directory.
- Provides extensible API endpoints for agent communication (to be implemented).

## UI
- Single-page application with server-rendered HTML.
- Sidebar layout: sessions/settings sidebar, main chat area.
- Dark theme by default using CSS variables for easy theming.
- Client-side logic in `public/js/main.js` as a class encapsulating UI interactions.
- No frameworks; plain DOM API.

## Styling
- CSS file `public/css/style.css` defines variables and component styles.
- Responsive design using flexbox.
- Tool cards, diff views, and message styling defined for future features.

## Development Practices
- Test-driven development: write tests before or alongside features.
- Use Node's built-in test runner (`node --test`).
- Keep `main` branch green; feature branches for each feature.
- Small, frequent commits with conventional commit messages.

