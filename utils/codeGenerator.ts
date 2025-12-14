
import { GeneratedCode } from "../types";

export const constructFullDocument = (code: GeneratedCode, projectId?: string): string => {
  let rawJs = code.javascript || '';

  // --- CLEANUP ---
  // Ensure we clean up any potential markdown blocks or import statements that might have slipped through
  rawJs = rawJs.replace(/^```javascript/gm, '').replace(/^```/gm, '');
  rawJs = rawJs.replace(/^import .*$/gm, '// import removed'); 
  rawJs = rawJs.replace(/^export default .*$/gm, '// export default removed');

  // Inject Project ID for Router Logic
  const projectIdInjection = projectId ? `window.__PROJECT_ID__ = "${projectId}";` : 'window.__PROJECT_ID__ = null;';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    
    <!-- ERROR STYLES -->
    <style>
        html, body { height: 100%; width: 100%; margin: 0; padding: 0; overflow: hidden; }
        body { font-family: sans-serif; background-color: #ffffff; color: #1f2937; }
        #root { width: 100%; height: 100%; overflow: auto; }
        #error-overlay {
            display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(254, 226, 226, 0.95); color: #991b1b; z-index: 9999;
            padding: 2rem; box-sizing: border-box; flex-direction: column; overflow: auto;
        }
        .error-title { font-weight: bold; font-size: 1.25rem; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
        .error-pre { background: #fff; padding: 1rem; border-radius: 0.5rem; border: 1px solid #f87171; overflow-x: auto; font-family: monospace; font-size: 0.875rem; white-space: pre-wrap; }
        ${code.css || ''}
    </style>

    <!-- CRITICAL: ERROR HANDLER -->
    <script>
        window.process = { env: { NODE_ENV: 'development' } }; // Prevent lib crashes immediately
        ${projectIdInjection}

        window.showError = function(type, message, stack) {
            const overlay = document.getElementById('error-overlay');
            const content = document.getElementById('error-content');
            if (overlay && content) {
                overlay.style.display = 'flex';
                let cleanMessage = message || 'Unknown error';
                content.innerHTML = '<div class="error-title">⚠️ ' + type + '</div>' + 
                                    '<div class="error-pre">' + cleanMessage + '</div>' +
                                    (stack ? '<div class="error-pre" style="margin-top:1rem; color:#666; font-size:0.75rem">' + stack + '</div>' : '');
            }
            // Send to parent for auto-fix AI agent
            window.parent.postMessage({ type: 'RUNTIME_ERROR', message: type + ": " + message }, '*');
        };

        window.onerror = function(msg, url, line, col, error) {
            window.showError('Runtime Error', msg, error ? error.stack : '');
            return true; // Suppress default browser error
        };

        window.onunhandledrejection = function(event) {
            window.showError('Async Error', event.reason ? event.reason.message : 'Unknown Promise Rejection');
        };
        
        // Network Error Handler for Scripts
        window.handleScriptError = function(src) {
            window.showError('Network Error', 'Failed to load core dependency: ' + src + '. Please check your connection.');
        };
    </script>

    <!-- CORE DEPENDENCIES (Stable CDNs only) -->
    <script src="https://cdn.tailwindcss.com" onerror="window.handleScriptError(this.src)"></script>
    <script crossorigin="anonymous" src="https://unpkg.com/react@18/umd/react.development.js" onerror="window.handleScriptError(this.src)"></script>
    <script crossorigin="anonymous" src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" onerror="window.handleScriptError(this.src)"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js" onerror="window.handleScriptError(this.src)"></script>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" onerror="window.handleScriptError(this.src)"></script>
    
    <!-- React Router (Global Access: window.ReactRouterDOM) -->
    <script crossorigin="anonymous" src="https://unpkg.com/history@5/umd/history.development.js" onerror="window.handleScriptError(this.src)"></script>
    <script crossorigin="anonymous" src="https://unpkg.com/react-router@6.3.0/umd/react-router.development.js" onerror="window.handleScriptError(this.src)"></script>
    <script crossorigin="anonymous" src="https://unpkg.com/react-router-dom@6.3.0/umd/react-router-dom.development.js" onerror="window.handleScriptError(this.src)"></script>
</head>
<body>
    <div id="root"></div>
    <div id="error-overlay"><div id="error-content" class="w-full max-w-3xl mx-auto"></div></div>

    <!-- RAW CODE STORAGE -->
    <script type="text/plain" id="user-code">${rawJs}</script>

    <script>
        // --- SYSTEM BOOTSTRAP ---
        
        // 1. Supabase Setup
        // The CDN exposes 'supabase' as the global variable (which has createClient)
        if (window.supabase) {
            if (window.supabase.createClient) {
                // Expose createClient globally to handle case where import { createClient } was removed
                window.createClient = window.supabase.createClient;
                window.supabaseClient = window.supabase;
            }
        }

        // 2. Strict Shim (Block Imports)
        window.require = function(name) {
            console.warn("[Shim] Prevented require for:", name);
            if (name === 'react') return window.React;
            if (name === 'react-dom') return window.ReactDOM;
            if (name === 'react-router-dom') return window.ReactRouterDOM;
            if (name === '@supabase/supabase-js') return window.supabase;
            // Return empty objects for forbidden libs to prevent immediate crash if AI slips up
            return {}; 
        };
        
        // 3. Environment Globals
        window.exports = {};
        window.module = { exports: {} };

        // 4. ROUTER OVERRIDE (Unified Router)
        // This ensures whether we are in a small preview or a full-page deep link URL, routing works.
        (function() {
            const { HashRouter, MemoryRouter, useNavigate, useLocation } = window.ReactRouterDOM;
            const React = window.React;

            const UnifiedRouter = ({ children }) => {
                // Determine if we are in Full Preview Mode (iframe inside a route like #/preview/:id)
                // or just a small canvas preview (memory router preferred).
                
                const [initialPath, setInitialPath] = React.useState("/");
                const [mode, setMode] = React.useState('memory'); // 'memory' | 'hash' (native)

                React.useLayoutEffect(() => {
                    // STANDALONE MODE (No Parent) -> Use HashRouter
                    if (window.self === window.top) {
                        setMode('hash');
                        return;
                    }

                    // IFRAME MODE
                    try {
                        const projectId = window.__PROJECT_ID__;
                        const parentHash = window.parent.location.hash; // e.g. #/preview/123/about
                        
                        // Check if parent URL matches this project's preview base
                        if (projectId && parentHash.includes('/preview/' + projectId)) {
                            // Extract sub-path
                            const prefix = '#/preview/' + projectId;
                            let subPath = parentHash.replace(prefix, '');
                            if (!subPath.startsWith('/')) subPath = '/' + subPath;
                            
                            // If exactly matching base, default to /
                            if (subPath === '/' || subPath === '') subPath = '/';
                            
                            setInitialPath(subPath);
                            setMode('sync'); // Use MemoryRouter but Sync with Parent
                        } else {
                            // Just a builder preview, keep isolated
                            setMode('memory');
                        }
                    } catch (e) {
                        // Security block or cross-origin -> Default to Memory
                        setMode('memory');
                    }
                }, []);

                if (mode === 'hash') {
                    return React.createElement(HashRouter, {}, children);
                }

                // SYNC COMPONENT (Updates Parent URL when internal nav happens)
                const RouterSync = () => {
                    const navigate = useNavigate();
                    const location = useLocation();
                    
                    React.useEffect(() => {
                        if (mode !== 'sync') return;
                        try {
                            const projectId = window.__PROJECT_ID__;
                            // Construct new parent hash
                            const newParentHash = '/preview/' + projectId + location.pathname;
                            
                            // Prevent infinite loops by checking current parent hash
                            const currentParentHash = window.parent.location.hash.slice(1); // remove #
                            
                            if (currentParentHash !== newParentHash) {
                                // Update parent without reloading
                                window.parent.history.replaceState(null, '', '#' + newParentHash);
                            }
                        } catch(e) {}
                    }, [location, mode]);
                    
                    return null;
                };

                // WRAPPER
                return React.createElement(
                    MemoryRouter, 
                    { initialEntries: [initialPath] }, 
                    React.createElement(RouterSync),
                    children
                );
            };

            // Force all Router usages to use our Shim
            window.ReactRouterDOM.HashRouter = UnifiedRouter;
            window.ReactRouterDOM.BrowserRouter = UnifiedRouter; // Safety net
        })();

        // --- COMPILE & RUN ---
        (function() {
            try {
                const rawCode = document.getElementById('user-code').textContent;
                if (!rawCode || !rawCode.trim()) return;

                // Babel Transform
                const compiled = Babel.transform(rawCode, {
                    presets: [
                        ['env', { modules: false }], // Turn OFF module transformation (handle manually)
                        'react'
                    ],
                    filename: 'main.tsx'
                }).code;

                // Execute
                eval(compiled);

            } catch (e) {
                window.showError(e.name || 'Script Error', e.message, e.stack);
            }
        })();
    </script>
</body>
</html>
  `;
};

export const createDeployableBlob = (code: GeneratedCode, projectId?: string): string => {
  const fullHtml = constructFullDocument(code, projectId);
  const blob = new Blob([fullHtml], { type: 'text/html' });
  return URL.createObjectURL(blob);
};
