# Online3DViewer Development Guide

## Build Commands
- `npm run build_dev`: Builds development versions of engine and website
- `npm run build_engine_dev`: Builds development version of engine only
- `npm run build_website_dev`: Builds development version of website
- `npm start`: Builds dev version and starts http-server

## Test Commands
- `npm run test`: Runs all unit tests with Mocha
- `mocha test/tests/specific_test.js`: Run a single test file

## Lint and Style
- `npm run lint`: Runs ESLint on source code
- `npm run lint_fix`: Runs ESLint with auto-fix option

## Code Style Guidelines
- Classes/Functions: Use PascalCase (e.g., `ImporterFile`, `SetContent`)
- Variables: Use camelCase (e.g., `contentDiv`, `buttonDiv`)
- Strings: Use single quotes, not double quotes
- Use ES6 modules with named exports (no default exports)
- No var declarations (use let/const)
- Strict equality checks (===)
- JSDoc style comments for documentation
- Always use semicolons
- Pull requests must target the `dev` branch

## Error Handling
- Use Promise-based error handling with catch blocks
- Use callbacks for async operations (onReady, onProgress patterns)
- Early returns for invalid conditions