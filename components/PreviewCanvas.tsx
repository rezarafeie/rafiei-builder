
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { GeneratedCode, ProjectFile } from '../types';
import { constructFullDocument } from '../utils/codeGenerator';
import { Loader2, RefreshCw, Eye, ExternalLink } from 'lucide-react';

interface PreviewCanvasProps {
  code: GeneratedCode | null;
  files?: ProjectFile[];
  className?: string;
  isGenerating?: boolean;
  isUpdating?: boolean;
  onRuntimeError?: (error: string) => void;
  projectId?: string; // Optional: Used for context-aware routing injection
  active?: boolean; // Optimization: Pause updates when hidden
  externalUrl?: string; // Optional: External deployment URL (Vercel)
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

// Simple hash for content
const hashCode = (s: string) => {
    let h = 0, i = 0;
    if (s.length > 0)
        while (i < s.length)
            h = (h << 5) - h + s.charCodeAt(i++) | 0;
    return h;
};

const PreviewCanvas: React.FC<PreviewCanvasProps> = ({ code, files, className, isGenerating = false, isUpdating = false, onRuntimeError, projectId, active = true, externalUrl }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasRuntimeError, setHasRuntimeError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  
  // Memoize document string to prevent unnecessary iframe reloads
  const docString = useMemo(() => {
      // Prioritize external URL if available and NOT generating
      if (externalUrl && !isGenerating && !isUpdating) return null;

      if (files && files.length > 0) {
          return constructFullDocument({ html: '', javascript: '', css: '', explanation: '' }, projectId, files);
      }
      if (code && (code.html || code.javascript)) {
          return constructFullDocument(code, projectId);
      }
      return null;
  }, [code, files, projectId, externalUrl, isGenerating, isUpdating]);

  // Compute a content hash to force updates if content changes
  const contentHash = useMemo(() => docString ? hashCode(docString) : 0, [docString]);

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
    // Optimization: Skip updates if not active (e.g. hidden mobile tab)
    if (!active) return;

    // Reset error state and start loading
    setHasRuntimeError(false);
    setShowErrorDetails(false);
    setIsLoading(true);

    if (iframeRef.current) {
        if (externalUrl && !isGenerating && !isUpdating) {
            // USE VERCEL PREVIEW
            if (iframeRef.current.src !== externalUrl) {
                iframeRef.current.src = externalUrl;
                iframeRef.current.removeAttribute('srcdoc');
            } else {
                setIsLoading(false); // Already on correct URL
            }
        } else if (docString) {
            // USE LOCAL PREVIEW
            iframeRef.current.srcdoc = docString;
            iframeRef.current.removeAttribute('src');
        } else if (isGenerating) {
            iframeRef.current.srcdoc = `<!DOCTYPE html><html><body style="background:#0f172a;color:#94a3b8;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><div>Building...</div></body></html>`;
            iframeRef.current.removeAttribute('src');
        } else {
            iframeRef.current.srcdoc = `<!DOCTYPE html><html><body style="background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#64748b;"><div>Ready to Build</div></body></html>`;
            iframeRef.current.removeAttribute('src');
        }
    }
  }, [docString, isGenerating, isUpdating, reloadKey, active, contentHash, externalUrl]);

  const handleReload = () => {
    setIsLoading(true);
    if (iframeRef.current && externalUrl && !isGenerating) {
        // Force reload of external URL by appending/changing timestamp
        const url = new URL(externalUrl);
        url.searchParams.set('t', Date.now().toString());
        iframeRef.current.src = url.toString();
    } else {
        setReloadKey(prev => prev + 1);
    }
    setHasRuntimeError(false);
    setShowErrorDetails(false);
  };

  return (
    <div className={`w-full h-full bg-[#0f172a] rounded-lg overflow-hidden shadow-xl border border-gray-700 relative group ${className}`}>
      
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

      {(isLoading || isGenerating || isUpdating) && (
          <div className="absolute top-0 left-0 right-0 h-1 z-30 bg-transparent overflow-hidden pointer-events-none">
              <div className="w-full h-full loading-bar-shim"></div>
          </div>
      )}

      {!isGenerating && !isUpdating && (
        <div className="absolute top-4 right-4 z-20 flex gap-2">
            {externalUrl && (
                <a 
                    href={externalUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg backdrop-blur-sm border border-slate-600/50 shadow-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    title="Open in new tab"
                >
                    <ExternalLink size={16} />
                </a>
            )}
            <button 
                onClick={handleReload}
                className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg backdrop-blur-sm border border-slate-600/50 shadow-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                title="Reload Preview"
            >
                <RefreshCw size={16} />
            </button>
        </div>
      )}

      {/* Deployment Status Indicator */}
      {externalUrl && !isGenerating && !isUpdating && (
          <div className="absolute bottom-4 right-4 z-20 px-3 py-1 bg-emerald-500/90 backdrop-blur-sm text-white text-xs font-bold rounded-full shadow-lg pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity">
              Live Preview
          </div>
      )}

      <iframe
        ref={iframeRef}
        key={`${reloadKey}-${contentHash}`}
        title="App Preview"
        className="w-full h-full bg-white"
        sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
        loading="lazy"
        onLoad={() => setIsLoading(false)}
      />
      
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
