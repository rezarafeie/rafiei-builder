
import { GeneratedCode, ProjectFile } from "../types";

export const constructFullDocument = (code: GeneratedCode, projectId?: string, files?: ProjectFile[]): string => {
  if (files && files.length > 0) {
    return constructMultiFileDocument(files, projectId);
  }
  return constructSingleFileDocument(code, projectId);
};

export const constructMultiFileDocument = (files: ProjectFile[], projectId?: string): string => {
  const projectIdInjection = projectId ? `window.__PROJECT_ID__ = "${projectId}";` : 'window.__PROJECT_ID__ = null;';
  
  // 1. Precise Entry Point Detection
  let entryFile = files.find(f => 
    f.path === 'src/main.tsx' || 
    f.path === 'src/index.tsx' || 
    f.path === 'src/main.jsx' || 
    f.path === 'src/index.jsx' ||
    f.path === 'main.tsx' ||
    f.path === 'index.tsx'
  );

  // 2. Fallback: Search for reasonable alternatives
  if (!entryFile) {
      entryFile = files.find(f => f.path.endsWith('src/App.tsx') || f.path.endsWith('App.tsx'));
  }
  if (!entryFile) {
      entryFile = files.find(f => f.path.endsWith('.tsx') || f.path.endsWith('.jsx') || f.path.endsWith('.js'));
  }

  // Normalize entry path
  let entryPath = entryFile ? entryFile.path.replace(/^\.?\//, '') : '';

  // Pre-process files into a JSON map
  const fileMap = files.reduce((acc, file) => {
    const cleanPath = file.path.replace(/^\.?\//, '');
    acc[cleanPath] = file.content;
    return acc;
  }, {} as Record<string, string>);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: { extend: { colors: { primary: '#3b82f6' } } }
        };
        window.process = { env: { NODE_ENV: 'development' } };
        ${projectIdInjection}
    </script>
    <!-- React & DOM -->
    <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js"></script>
    <!-- Babel -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <!-- Supabase -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <!-- Router -->
    <script crossorigin src="https://unpkg.com/history@5/umd/history.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-router@6.3.0/umd/react-router.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-router-dom@6.3.0/umd/react-router-dom.development.js"></script>
    <!-- Icons -->
    <script src="https://unpkg.com/lucide-react@latest/dist/umd/lucide-react.min.js"></script>
    
    <style>
      html, body, #root { height: 100%; margin: 0; padding: 0; background-color: #ffffff; }
      #error-overlay { display: none; position: fixed; inset: 0; background: rgba(255,255,255,0.95); z-index: 9999; padding: 2rem; color: #ef4444; font-family: monospace; overflow: auto; pointer-events: none; }
      #error-overlay * { pointer-events: auto; }
    </style>
</head>
<body>
    <div id="root"></div>
    <div id="error-overlay"></div>

    <script>
      // --- ERROR HANDLER ---
      window.onerror = function(msg, url, line, col, error) {
        if (msg === 'ResizeObserver loop limit exceeded') return;
        
        // Forcefully ignore Router context errors as they are often false positives in this shimmed env
        if (typeof msg === 'string' && (
            msg.includes('useRoutes() may be used only in the context of a <Router>') || 
            msg.includes('useNavigate() may be used only in the context of a <Router>') ||
            msg.includes('useLocation() may be used only in the context of a <Router>')
        )) {
            console.warn('Suppressing Router context error (False Positive):', msg);
            return true;
        }

        const overlay = document.getElementById('error-overlay');
        overlay.style.display = 'block';
        overlay.innerHTML = '<h3 style="font-size:1.2rem;font-weight:bold;margin-bottom:1rem">Runtime Error</h3>' +
                            '<pre style="background:#fee2e2;padding:1rem;border-radius:0.5rem;white-space:pre-wrap">' + msg + '\\n\\n' + (error ? error.stack : '') + '</pre>';
        console.error('Runtime Error:', error);
        window.parent.postMessage({ type: 'RUNTIME_ERROR', message: msg }, '*');
        return false;
      };
      
      window.addEventListener('unhandledrejection', function(event) {
        window.onerror(event.reason.message, '', 0, 0, event.reason);
      });

      // --- SAFE PROXY ---
      const createSafeProxy = (target, moduleName) => {
        return new Proxy(target || {}, {
            get: (t, prop) => {
                if (prop in t) return t[prop];
                if (prop === 'default') return createSafeProxy(t, moduleName);
                if (prop === '__esModule') return true;
                if (typeof prop === 'string' && /^[A-Z]/.test(prop)) {
                    return (props) => window.React.createElement(
                        'div',
                        { 
                            style: { color: '#b91c1c', border: '1px dashed #ef4444', padding: '4px', fontSize: '10px' },
                            title: \`Missing: \${moduleName}.\${prop}\`
                        },
                        prop
                    );
                }
                return undefined;
            }
        });
      };

      // --- MODULE SYSTEM ---
      window.__MODULES__ = {}; 
      window.__SOURCES__ = ${JSON.stringify(fileMap)}; 

      function resolvePath(base, relative) {
        if (!relative.startsWith('.')) return relative; 
        const stack = base.split('/');
        stack.pop(); 
        const parts = relative.split('/');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === '.') continue;
          if (parts[i] === '..') stack.pop();
          else stack.push(parts[i]);
        }
        return stack.join('/');
      }

      function getFileContent(path) {
         if (window.__SOURCES__[path]) return { content: window.__SOURCES__[path], finalPath: path };
         const extensions = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'];
         for (let ext of extensions) {
             if (window.__SOURCES__[path + ext]) return { content: window.__SOURCES__[path + ext], finalPath: path + ext };
         }
         for (let ext of extensions) {
             if (window.__SOURCES__[path + '/index' + ext]) return { content: window.__SOURCES__[path + '/index' + ext], finalPath: path + '/index' + ext };
         }
         return null;
      }

      window.require = function(path, base = '') {
        // --- BUILT-INS ---
        if (path === 'react') return window.React;
        if (path === 'react-dom') return window.ReactDOM;
        if (path === 'react-dom/client') return window.ReactDOM;
        if (path === '@supabase/supabase-js') return window.supabase || createSafeProxy({}, '@supabase/supabase-js');
        if (path === 'lucide-react') return window.lucide || createSafeProxy({}, 'lucide-react');
        
        // --- ROUTER SHIM (STRICT FIX) ---
        if (path === 'react-router-dom' || path === 'react-router') {
            const rrd = window.ReactRouterDOM || {};
            const Passthrough = ({ children }) => children;
            return {
                ...rrd,
                BrowserRouter: Passthrough,
                HashRouter: Passthrough,
                MemoryRouter: Passthrough,
            };
        }

        const resolvedPath = resolvePath(base, path);
        const fileInfo = getFileContent(resolvedPath);
        if (!fileInfo) {
            console.warn('Module not found:', path, 'Resolved:', resolvedPath);
            return createSafeProxy({}, path); 
        }
        
        const { content, finalPath } = fileInfo;
        
        // 1. Check Cache
        if (window.__MODULES__[finalPath]) return window.__MODULES__[finalPath].exports;

        if (finalPath.endsWith('.css')) {
            const style = document.createElement('style');
            style.textContent = content;
            document.head.appendChild(style);
            window.__MODULES__[finalPath] = { exports: {} };
            return {};
        }

        if (finalPath.endsWith('.json')) {
             try {
                 const json = JSON.parse(content);
                 window.__MODULES__[finalPath] = { exports: json };
                 return json;
             } catch(e) {}
        }

        // --- COMPILATION (CIRCULAR DEP FIX) ---
        // 2. Register Module EARLY to support circular dependencies
        const module = { exports: {} };
        window.__MODULES__[finalPath] = module;

        try {
            // Guard: Check for hallucinated text files acting as code
            if (content.trim().indexOf('import ') !== 0 && content.trim().indexOf('export ') === -1 && content.trim().indexOf('<') === -1) {
                 if (content.length < 500 && (content.includes('Remove') || content.includes('Note:') || content.includes('Instructions:'))) {
                     throw new Error("File content appears to be text instructions, not code.");
                 }
            }

            const presets = [['env', { modules: 'commonjs' }], 'react'];
            if (finalPath.endsWith('.ts') || finalPath.endsWith('.tsx')) {
                presets.push('typescript');
            }
            const transformed = Babel.transform(content, { presets, filename: finalPath }).code;
            
            const wrapper = new Function('module', 'exports', 'require', transformed);
            wrapper(module, module.exports, (p) => window.require(p, finalPath));
            
            return module.exports;
        } catch (e) {
            console.error('Compilation Error in ' + finalPath, e);
            const ErrorComponent = () => window.React.createElement('div', { 
                style: { color: 'red', padding: 10, background: '#fee2e2', border: '1px solid red' } 
            }, 'Error compiling ' + finalPath + ': ' + e.message);
            // Update the cache with the error component so we don't retry infinite loops
            window.__MODULES__[finalPath].exports = { default: ErrorComponent, ErrorComponent }; 
            return window.__MODULES__[finalPath].exports;
        }
      };

      // --- BOOTSTRAP ---
      window.onload = function() {
          try {
              const rootEl = document.getElementById('root');
              if (!rootEl) throw new Error("Missing #root element");

              // 1. AUTO-DETECT APP COMPONENT
              const appFile = ['src/App.tsx', 'src/App.jsx', 'src/App.js', 'App.tsx', 'App.jsx', 'App.js'].find(p => window.__SOURCES__[p]);
              let mounted = false;

              if (appFile) {
                  try {
                      const mod = window.require(appFile);
                      // Support both default and named 'App' exports
                      const App = mod.default || mod.App;
                      
                      if (App) {
                          const React = window.React;
                          const ReactDOM = window.ReactDOM;
                          // Use REAL HashRouter from global UMD for the root context
                          const RealHashRouter = window.ReactRouterDOM.HashRouter;
                          
                          const root = ReactDOM.createRoot(rootEl);
                          root.render(React.createElement(RealHashRouter, {}, React.createElement(App)));
                          mounted = true;
                          console.log('Mounted App via ' + appFile);
                      } else {
                          throw new Error("App component not found in exports. Ensure 'export default App' or 'export const App'.");
                      }
                  } catch(e) {
                      console.warn('Auto-mount failed:', e);
                      throw e; // Re-throw to show error overlay
                  }
              }

              // 2. FALLBACK: EXECUTE ENTRY FILE (main.tsx)
              if (!mounted) {
                  const entry = "${entryPath}";
                  if (entry && window.__SOURCES__[entry]) {
                      console.log('Executing entry: ' + entry);
                      window.require(entry);
                  } else if (!appFile) {
                      document.body.innerHTML = '<div style="padding:20px;color:#64748b;">Waiting for entry point...</div>';
                  }
              }
          } catch (e) {
              console.error('Bootstrap Error:', e);
              window.onerror(e.message, '', 0, 0, e);
          }
      };

    </script>
</body>
</html>
  `;
};

// Legacy Single File Fallback (kept for stability of old projects)
const constructSingleFileDocument = (code: GeneratedCode, projectId?: string): string => {
  let rawJs = code.javascript || '';
  rawJs = rawJs.replace(/^```javascript/gm, '').replace(/^```tsx/gm, '').replace(/^```/gm, '');

  if (rawJs.includes('<Route') && !rawJs.includes('<Routes')) {
      if (rawJs.includes('<HashRouter>')) {
          rawJs = rawJs.replace(/<HashRouter>/g, '<HashRouter><Routes>');
          rawJs = rawJs.replace(/<\/HashRouter>/g, '</Routes></HashRouter>');
      } 
  }

  const projectIdInjection = projectId ? `window.__PROJECT_ID__ = "${projectId}";` : 'window.__PROJECT_ID__ = null;';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
        html, body { height: 100%; width: 100%; margin: 0; padding: 0; overflow: hidden; }
        body { font-family: sans-serif; background-color: #ffffff; color: #1f2937; }
        #root { width: 100%; height: 100%; overflow: auto; }
        #error-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(254, 226, 226, 0.95); color: #991b1b; z-index: 9999; padding: 2rem; box-sizing: border-box; }
        ${code.css || ''}
    </style>
    <script>
        window.process = { env: { NODE_ENV: 'development' } };
        ${projectIdInjection}
        window.showError = function(type, message) {
            const overlay = document.getElementById('error-overlay');
            if (overlay) { overlay.style.display = 'block'; overlay.innerText = type + ': ' + message; }
            window.parent.postMessage({ type: 'RUNTIME_ERROR', message: type + ": " + message }, '*');
        };
        window.onerror = function(msg, url, line, col, error) { window.showError('Runtime Error', msg); return true; };
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script crossorigin src="https://unpkg.com/history@5/umd/history.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-router@6.3.0/umd/react-router.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-router-dom@6.3.0/umd/react-router-dom.development.js"></script>
    <script src="https://unpkg.com/lucide-react@latest/dist/umd/lucide-react.min.js"></script>
</head>
<body>
    <div id="root"></div>
    <div id="error-overlay"></div>
    <script type="text/plain" id="user-code">${rawJs}</script>
    <script>
        const createSafeProxy = (target, name) => new Proxy(target || {}, { 
            get: (t, p) => {
                if (p in t) return t[p];
                if (p === 'default') return createSafeProxy(t, name);
                return (props) => window.React.createElement('div', { style: { color: 'red', border: '1px dashed red', padding: '2px', display: 'inline-block' } }, name + '.' + String(p));
            } 
        });
        
        if(window.supabase) { window.createClient = window.supabase.createClient; }
        window.lucideReact = window.lucide || createSafeProxy({}, 'lucide');
        window.ReactRouterDOM = window.ReactRouterDOM || createSafeProxy({}, 'ReactRouterDOM');
        
        window.require = function(name) {
            if (name === 'react') return window.React;
            if (name === 'react-dom') return window.ReactDOM;
            if (name === 'react-dom/client') return window.ReactDOM;
            if (name === 'react-router-dom') return window.ReactRouterDOM;
            if (name === '@supabase/supabase-js') return window.supabase;
            if (name === 'lucide-react') return window.lucideReact;
            return createSafeProxy({}, name);
        };
        (function() {
            const { HashRouter, MemoryRouter, useNavigate, useLocation } = window.ReactRouterDOM;
            const React = window.React;
            const UnifiedRouter = ({ children }) => {
                const RouterComponent = HashRouter || (({children}) => React.createElement('div', {}, children));
                return React.createElement(RouterComponent, {}, children);
            };
            window.ReactRouterDOM.HashRouter = UnifiedRouter;
            window.ReactRouterDOM.BrowserRouter = UnifiedRouter;
        })();
        (function() {
            try {
                const rawCode = document.getElementById('user-code').textContent;
                const compiled = Babel.transform(rawCode, { presets: [['env', { modules: 'umd' }], 'react'], filename: 'main.tsx' }).code;
                eval(compiled);
            } catch (e) { window.showError(e.name, e.message); }
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
