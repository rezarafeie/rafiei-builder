
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { GeneratedCode } from '../types';
import { constructFullDocument } from '../utils/codeGenerator';
import { Loader2, RefreshCw, Eye } from 'lucide-react';

interface PreviewCanvasProps {
  code: GeneratedCode | null;
  className?: string;
  isGenerating?: boolean;
  isUpdating?: boolean;
  onRuntimeError?: (error: string) => void;
  projectId?: string; // Optional: Used for context-aware routing injection
}

const loadingMessages = [
  "Compiling pixels into a masterpiece...",
  "Teaching components how to speak React...",
  "Aligning divs and herding cats...",
  "Polishing JSX until it shines...",
  "Negotiating with the CSS specificity gods...",
  "Warming up the AI's creativity cores...",
  "Untangling the virtual wires of the DOM...",
  "Assembling state and props into a symphony...",
  "Brewing some fresh JavaScript...",
  "Reticulating splines..."
];

const fixingMessages = [
  "Cooking up a fix...",
  "Noodling on the solution...",
  "Investigating the glitch...",
  "Rewiring the mainframe...",
  "Exterminating bugs...",
  "Applying digital duct tape...",
  "Consulting the oracle...",
  "De-greasing the gears...",
  "Sanitizing the inputs...",
  "Re-calibrating the flux capacitor..."
];

const PreviewCanvas: React.FC<PreviewCanvasProps> = ({ code, className, isGenerating = false, isUpdating = false, onRuntimeError, projectId }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasRuntimeError, setHasRuntimeError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  
  // Memoize document string to prevent unnecessary iframe reloads if code object identity changes but content is same
  const docString = useMemo(() => {
      if (code && (code.html || code.javascript)) {
          return constructFullDocument(code, projectId);
      }
      return null;
  }, [code?.html, code?.javascript, code?.css, projectId]);

  // Pick a random message when the error state changes
  const activeFixingMessage = useMemo(() => {
      return fixingMessages[Math.floor(Math.random() * fixingMessages.length)];
  }, [hasRuntimeError, isUpdating]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'RUNTIME_ERROR') {
            setHasRuntimeError(true);
            if (onRuntimeError) {
                onRuntimeError(event.data.message);
            }
        }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRuntimeError]);

  useEffect(() => {
    // Reset error state and start loading
    setHasRuntimeError(false);
    setShowErrorDetails(false);
    setIsLoading(true);

    if (iframeRef.current) {
        if (docString) {
            iframeRef.current.srcdoc = docString;
        } else if (isGenerating) {
            iframeRef.current.srcdoc = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
                            color: #94a3b8; /* Slate 400 */
                            background-color: #0f172a; /* Slate 900 */
                            overflow: hidden;
                        }
                        .container { 
                            text-align: center; 
                            animation: fadeIn 0.5s ease-out;
                        }
                        .loader {
                            width: 48px;
                            height: 48px;
                            border: 4px solid #374151; /* Gray 700 */
                            border-top-color: #6366f1; /* Indigo 500 */
                            border-radius: 50%;
                            display: inline-block;
                            box-sizing: border-box;
                            animation: rotation 1s linear infinite;
                            margin-bottom: 24px;
                        }
                        h2 { 
                            font-size: 1.25rem; 
                            font-weight: 600; 
                            color: #e2e8f0; /* Slate 200 */
                            margin-bottom: 8px; 
                            letter-spacing: -0.025em;
                        }
                        p { 
                            font-size: 0.875rem; 
                            max-width: 280px;
                            min-height: 2.5em; /* Prevent layout shift */
                            transition: opacity 0.4s ease-in-out;
                        }
                        @keyframes rotation {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                        @keyframes fadeIn {
                            from { opacity: 0; transform: translateY(10px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="loader"></div>
                        <h2>Building your vision...</h2>
                        <p id="loading-text">${loadingMessages[0]}</p>
                    </div>
                    <script>
                        const messages = ${JSON.stringify(loadingMessages)};
                        const p = document.getElementById('loading-text');
                        let currentIndex = 0;

                        const intervalId = setInterval(() => {
                            // Pick a random index, but not the same as the current one
                            let nextIndex;
                            do {
                                nextIndex = Math.floor(Math.random() * messages.length);
                            } while (messages.length > 1 && nextIndex === currentIndex);
                            
                            currentIndex = nextIndex;
                            
                            p.style.opacity = 0;
                            setTimeout(() => {
                                p.textContent = messages[currentIndex];
                                p.style.opacity = 1;
                            }, 400); // Should match transition duration
                        }, 2500);
                    </script>
                </body>
                </html>
            `;
        } else {
            iframeRef.current.srcdoc = `
                <!DOCTYPE html>
                <html>
                <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;color:#64748b;background:#f8fafc;">
                    <div style="text-align:center;">
                        <h2>Ready to Build</h2>
                        <p>Describe your app in the chat to start generating.</p>
                    </div>
                </body>
                </html>
            `;
        }
    }
  }, [docString, isGenerating, isUpdating, reloadKey]);

  const handleReload = () => {
    setIsLoading(true);
    setReloadKey(prev => prev + 1);
    setHasRuntimeError(false);
    setShowErrorDetails(false);
  };

  return (
    <div className={`w-full h-full bg-[#0f172a] rounded-lg overflow-hidden shadow-xl border border-gray-700 relative group ${className}`}>
      
      {/* Loading Bar Animation Style */}
      <style>
        {`
            @keyframes loading-scan {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
            .loading-bar-shim {
                animation: loading-scan 1.5s infinite linear;
                background: linear-gradient(90deg, transparent, #6366f1, transparent);
            }
        `}
      </style>

      {/* Top Loading Bar */}
      {(isLoading || isGenerating || isUpdating) && (
          <div className="absolute top-0 left-0 right-0 h-1 z-30 bg-transparent overflow-hidden pointer-events-none">
              <div className="w-full h-full loading-bar-shim"></div>
          </div>
      )}

      {docString && !isGenerating && !isUpdating && (
        <button 
            onClick={handleReload}
            className="absolute top-4 right-4 z-20 p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg backdrop-blur-sm border border-slate-600/50 shadow-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
            title="Reload Preview"
        >
            <RefreshCw size={16} />
        </button>
      )}

      <iframe
        ref={iframeRef}
        key={reloadKey}
        title="App Preview"
        className="w-full h-full bg-white"
        sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
        loading="lazy"
        onLoad={() => setIsLoading(false)}
      />
      
      {/* Show overlay ONLY if updating AND there is a runtime error we are trying to fix, and user hasn't dismissed it */}
      {isUpdating && hasRuntimeError && !showErrorDetails && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-200">
            <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 bg-slate-800 px-6 py-4 rounded-full shadow-xl border border-slate-700">
                    <Loader2 className="animate-spin text-indigo-400" size={20} />
                    <span className="font-medium text-slate-200">{activeFixingMessage}</span>
                </div>
                <button 
                    onClick={() => setShowErrorDetails(true)}
                    className="flex items-center gap-2 text-xs text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 px-3 py-1.5 rounded-full transition-colors border border-transparent hover:border-slate-600"
                >
                    <Eye size={12} />
                    Show Error
                </button>
            </div>
        </div>
      )}
    </div>
  );
};

export default PreviewCanvas;
