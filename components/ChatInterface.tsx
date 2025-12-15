
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Suggestion, BuildState } from '../types';
import { Send, Sparkles, Square, RefreshCw, Wrench, Lightbulb, Paperclip, X, Image as ImageIcon, Loader2, AlertTriangle, Cloud, Wand2, Copy, MoreHorizontal, Clock, Check, Coins, CheckCircle2, XCircle } from 'lucide-react';
import ThinkingTerminal from './ThinkingTerminal';
import CloudConnectionTerminal from './CloudConnectionTerminal';
import { useTranslation } from '../utils/translations';
import { fileToBase64 } from '../services/cloudService';

// ... existing interfaces ...
interface ImageUpload {
  id: string;
  file: File;
  previewUrl: string;
  serverUrl?: string;
  base64?: string;
  uploading: boolean;
  error?: boolean;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (content: string, images: { url: string; base64: string }[]) => void;
  onUploadImage?: (file: File) => Promise<string>;
  onStop: () => void;
  onRetry: (prompt: string) => void;
  onAutoFix: () => void;
  onClearBuildState?: () => void;
  onConnectDatabase?: () => void;
  isThinking: boolean;
  isAutoRepairing?: boolean;
  buildState: BuildState | null;
  suggestions: Suggestion[];
  isSuggestionsLoading: boolean;
  runtimeError?: string | null;
  cloudConnectionStatus?: 'idle' | 'provisioning' | 'waking' | 'success' | 'error';
  cloudConnectionError?: string | null;
  onCloudConnectRetry?: () => void;
  onClearCloudConnectionState?: () => void;
}

const SUCCESS_SOUND_URL = 'https://cdn.pixabay.com/audio/2022/03/15/audio_2b28b1e36c.mp3';

// Markdown Renderer
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3);
          return <pre key={index} className="bg-black/5 dark:bg-black/20 text-slate-800 dark:text-gray-300 p-2 rounded-md my-1.5 overflow-x-auto text-[11px] font-mono border border-black/5 dark:border-white/5"><code>{code}</code></pre>;
        }
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="bg-black/5 dark:bg-white/10 text-indigo-600 dark:text-indigo-300 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-slate-900 dark:text-white">{part.slice(2, -2)}</strong>;
        return <span key={index}>{part}</span>;
      })}
    </div>
  );
};

// ... Helpers ...
const formatTime = (ms: number) => {
  if (!ms) return null;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatCredits = (credits: number) => {
  if (credits === undefined) return null;
  if (credits === 0) return '0';
  return credits < 0.01 ? '< 0.01' : credits.toFixed(2);
};

const MessageActions: React.FC<{ msg: Message }> = ({ msg }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(msg.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (msg.role === 'user') return null;

    return (
        <div className="flex items-center gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={handleCopy} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" title="Copy">
                {copied ? <Check size={12} className="text-emerald-500"/> : <Copy size={12}/>}
            </button>
            {(msg.executionTimeMs || msg.creditsUsed) && (
                <div className="flex items-center gap-2 text-[10px] text-slate-400 select-none">
                    {msg.executionTimeMs && <span>{formatTime(msg.executionTimeMs)}</span>}
                    {msg.creditsUsed && <span>• {formatCredits(msg.creditsUsed)} cr</span>}
                </div>
            )}
        </div>
    );
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    messages, onSendMessage, onUploadImage, onStop, onRetry, onAutoFix, onClearBuildState, onConnectDatabase, isThinking, isAutoRepairing,
    buildState, suggestions, isSuggestionsLoading, runtimeError,
    cloudConnectionStatus = 'idle',
    cloudConnectionError,
    onCloudConnectRetry,
    onClearCloudConnectionState,
}) => {
  const [input, setInput] = useState('');
  const [stagedImages, setStagedImages] = useState<ImageUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const successSoundRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasThinkingRef = useRef(false);
  const { t, dir } = useTranslation();

  useEffect(() => {
    successSoundRef.current = new Audio(SUCCESS_SOUND_URL);
    successSoundRef.current.volume = 0.5;
    successSoundRef.current.onerror = () => { successSoundRef.current = null; };
  }, []);

  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, buildState, runtimeError, cloudConnectionStatus]);

  useEffect(() => {
    if (!isThinking && wasThinkingRef.current) {
        successSoundRef.current?.play().catch(() => {});
    }
    wasThinkingRef.current = isThinking;
  }, [isThinking]);

  // ... File Handling Logic (Simplified for brevity, assume largely same as before) ...
  const handleFileValidation = (file: File): boolean => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) { alert('Invalid file type'); return false; }
      if (file.size > 10 * 1024 * 1024) { alert('File too large'); return false; }
      return true;
  };

  const addFilesToStage = async (files: File[]) => {
      const validFiles = Array.from(files).filter(handleFileValidation);
      if (validFiles.length === 0) return;
      const newUploads: ImageUpload[] = validFiles.map(file => ({
          id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), uploading: true
      }));
      setStagedImages(prev => [...prev, ...newUploads]);
      for (const upload of newUploads) {
          try {
              const fullBase64 = await fileToBase64(upload.file);
              const pureBase64 = fullBase64.split(',')[1] || fullBase64;
              let serverUrl = upload.previewUrl; 
              if (onUploadImage) serverUrl = await onUploadImage(upload.file);
              setStagedImages(prev => prev.map(p => p.id === upload.id ? { ...p, base64: pureBase64, serverUrl, uploading: false } : p));
          } catch (error) {
              setStagedImages(prev => prev.map(p => p.id === upload.id ? { ...p, uploading: false, error: true } : p));
          }
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFilesToStage(Array.from(e.target.files)); if (fileInputRef.current) fileInputRef.current.value = ''; };
  const removeStagedImage = (id: string) => { setStagedImages(prev => prev.filter(img => img.id !== id)); };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedImages.some(img => img.uploading)) return;
    if ((input.trim() || stagedImages.length > 0) && !isThinking) {
      const validImages = stagedImages.filter(img => !img.error && img.serverUrl && img.base64).map(img => ({ url: img.serverUrl!, base64: img.base64! }));
      onSendMessage(input.trim(), validImages);
      setInput('');
      setStagedImages([]);
    }
  };

  const dropHandler = useCallback((ev: React.DragEvent<HTMLDivElement>) => { ev.preventDefault(); setIsDragging(false); if (ev.dataTransfer.files) addFilesToStage(Array.from(ev.dataTransfer.files)); }, []);
  const dragOverHandler = (ev: React.DragEvent<HTMLDivElement>) => { ev.preventDefault(); setIsDragging(true); };
  const dragLeaveHandler = () => setIsDragging(false);
  const pasteHandler = useCallback((ev: ClipboardEvent) => { if (ev.clipboardData) { const items = Array.from(ev.clipboardData.items).filter(item => item.type.indexOf('image') !== -1); if (items.length > 0) addFilesToStage(items.map(item => item.getAsFile()).filter(Boolean) as File[]); } }, []);
  useEffect(() => { window.addEventListener('paste', pasteHandler); return () => window.removeEventListener('paste', pasteHandler); }, [pasteHandler]);

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const handleRetryClick = () => lastUserMessage && onRetry(lastUserMessage.content);
  const handleSuggestionClick = (prompt: string) => { setInput(prompt); document.getElementById('chat-input')?.focus(); };

  const shouldShowBuildTerminal = isThinking || (buildState && buildState.plan.length > 0) || (buildState?.error != null);
  const isUploading = stagedImages.some(img => img.uploading);

  // --- Render Message Content ---
  const renderContent = (msg: Message) => {
      // 1. Job Summary as Clean List
      if (msg.type === 'job_summary' && msg.jobSummary) {
          const { title, status, plan } = msg.jobSummary;
          const isSuccess = status === 'completed';
          return (
              <div>
                  <div className={`font-semibold mb-2 flex items-center gap-2 ${isSuccess ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600'}`}>
                      {title}
                  </div>
                  {msg.content && <div className="mb-3 text-slate-600 dark:text-slate-300"><MarkdownRenderer content={msg.content} /></div>}
                  {plan.length > 0 && (
                      <div className="space-y-1.5 pl-2 border-l-2 border-slate-100 dark:border-slate-800">
                          {plan.map((step, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-slate-500">
                                  <div className="mt-1 w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                                  <span>{step}</span>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          );
      }

      // 2. Standard Message
      return (
          <>
            {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, idx) => (
                        <img key={idx} src={img} alt="attachment" className="h-20 w-auto rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                    ))}
                </div>
            )}
            <MarkdownRenderer content={msg.content} />
            
            {msg.requiresAction === 'CONNECT_DATABASE' && onConnectDatabase && (
                <button onClick={onConnectDatabase} className="mt-3 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition-all">
                    <Cloud size={14} /> {t('connectCloud')}
                </button>
            )}
          </>
      );
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0f172a] relative transition-colors duration-300 font-sans" onDrop={dropHandler} onDragOver={dragOverHandler} onDragLeave={dragLeaveHandler} dir={dir}>
      {isDragging && (
        <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center pointer-events-none">
            <ImageIcon size={48} className="text-indigo-500 mb-4 animate-bounce" />
            <p className="font-semibold text-slate-800 dark:text-white">{t('dropImages')}</p>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-gray-600 opacity-60">
                <Sparkles size={32} strokeWidth={1.5} />
                <p className="mt-4 text-sm font-medium">{t('startBuilding')}</p>
            </div>
        )}
        
        {/* Message Stream */}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-4 group animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
             
             {/* Avatar */}
             <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                 msg.role === 'user' ? 'bg-slate-100 dark:bg-slate-800' : 'bg-indigo-50 dark:bg-indigo-900/10'
             }`}>
                 {msg.role === 'user' ? (
                     <div className="text-xs font-bold text-slate-600 dark:text-slate-400">U</div>
                 ) : (
                     <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400" />
                 )}
             </div>

             {/* Content Bubble */}
             <div className={`max-w-[85%] text-sm ${
                 msg.role === 'user' 
                 ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-4 py-2.5 rounded-2xl rounded-tr-sm' 
                 : 'text-slate-700 dark:text-slate-300 pt-1'
             }`}>
                 {renderContent(msg)}
                 <MessageActions msg={msg} />
             </div>
          </div>
        ))}
        
        {/* Inline Status Indicators (Acting as Messages) */}
        
        {cloudConnectionStatus !== 'idle' && (
            <div className="flex gap-4 animate-in fade-in">
                <div className="w-8 h-8 shrink-0" /> {/* Spacer to align with text */}
                <div className="max-w-[85%]">
                    <CloudConnectionTerminal
                        status={cloudConnectionStatus}
                        error={cloudConnectionError}
                        onRetry={onCloudConnectRetry}
                        onClose={onClearCloudConnectionState}
                    />
                </div>
            </div>
        )}
        
        {shouldShowBuildTerminal && (
            <div className="flex gap-4 animate-in fade-in">
                <div className="w-8 h-8 shrink-0" /> {/* Spacer */}
                <div className="max-w-[90%] w-full">
                    <ThinkingTerminal 
                        isComplete={!isThinking} 
                        plan={buildState?.plan || []} 
                        currentStepIndex={buildState?.currentStep || 0} 
                        error={buildState?.error || null} 
                        onRetry={handleRetryClick}
                        onClose={onClearBuildState}
                        phases={buildState?.phases}
                        currentPhaseIndex={buildState?.currentPhaseIndex}
                        logs={buildState?.logs}
                    />
                </div>
            </div>
        )}

        {/* Auto-Heal & Runtime Error Notices */}
        {!isThinking && (runtimeError || isAutoRepairing) && (
            <div className="flex gap-4 animate-in fade-in">
                <div className="w-8 h-8 shrink-0" />
                <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-lg text-xs max-w-[85%]">
                    <div className="flex items-center gap-2 font-medium text-red-600 dark:text-red-400 mb-1">
                        {isAutoRepairing ? <Wand2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                        {isAutoRepairing ? t('selfHealing') : t('runtimeError')}
                    </div>
                    {!isAutoRepairing && (
                        <>
                            <p className="text-red-500/80 mb-2">{runtimeError}</p>
                            <button onClick={() => onAutoFix()} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center gap-1">
                                <Wrench size={12} /> {t('autoFixError')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 sticky bottom-0 z-20 bg-gradient-to-t from-white via-white to-transparent dark:from-[#0f172a] dark:via-[#0f172a] dark:to-transparent">
        {isSuggestionsLoading && !isThinking && suggestions.length === 0 && (
            <div className="mb-2 flex items-center gap-2 px-2 text-xs text-slate-400 animate-pulse">
                <Loader2 size={12} className="animate-spin" /> {t('generatingSuggestions')}
            </div>
        )}

        {suggestions.length > 0 && !isThinking && (
          <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-500 shrink-0 px-1"><Lightbulb size={12} /><span>{t('next')}</span></div>
              {suggestions.filter(s => s && s.title).map((s, i) => (
                  <button key={i} onClick={() => handleSuggestionClick(s.prompt)} className="whitespace-nowrap bg-white dark:bg-[#1e293b] hover:border-indigo-300 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 text-xs transition-all shadow-sm">
                      {s.title}
                  </button>
              ))}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="relative group bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500/50 transition-all">
          {stagedImages.length > 0 && (
            <div className="p-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex gap-2 overflow-x-auto">
                    {stagedImages.map((img) => (
                        <div key={img.id} className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                            <img src={img.previewUrl} className={`w-full h-full object-cover ${img.uploading ? 'opacity-50' : ''}`} alt="preview" />
                            {img.uploading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-white" size={16} /></div>}
                            {img.error && <div className="absolute inset-0 flex items-center justify-center bg-red-500/50"><AlertTriangle className="text-white" size={16} /></div>}
                            <button type="button" onClick={() => removeStagedImage(img.id)} className="absolute top-0.5 right-0.5 bg-black/50 hover:bg-red-500 text-white rounded-full p-0.5 transition-colors"><X size={10} /></button>
                        </div>
                    ))}
                </div>
            </div>
          )}
          <div className="flex items-center pl-3 pr-3 py-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-indigo-500 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><Paperclip size={18} /></button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/png, image/jpeg, image/webp" multiple className="hidden" />
            <input id="chat-input" type="text" dir="auto" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('placeholder')} disabled={isThinking} className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none px-3 py-2" />
            <div className="">{isThinking ? (<button type="button" onClick={onStop} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Square size={16} fill="currentColor" /></button>) : (<button type="submit" disabled={(!input.trim() && stagedImages.length === 0) || isUploading} className="p-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"><Send size={16} className="rtl:rotate-180" /></button>)}</div>
          </div>
        </form>
      </div>
    </div>
  );
};
export default ChatInterface;
