
import React, { useEffect, useState, useRef } from 'react';
import { 
    Loader2, CheckCircle2, AlertTriangle, XCircle, RefreshCw, 
    Brain, Database, Wrench, Palette, Search, Code, Lock, Zap
} from 'lucide-react';
import { useTranslation } from '../utils/translations';
import { Phase, BuildAudit } from '../types';

interface ThinkingTerminalProps {
  plan: string[]; // Legacy
  currentStepIndex: number; // Legacy
  isComplete: boolean;
  error: string | null;
  onRetry?: () => void;
  onClose?: () => void;
  phases?: Phase[];
  currentPhaseIndex?: number;
  audit?: BuildAudit;
  logs?: string[];
}

const getStepInfo = (text: string) => {
    const safeText = text || '';
    const lower = safeText.toLowerCase();
    if (lower.includes('analyzing') || lower.includes('requirements')) return { icon: Brain, label: 'Think', color: 'text-purple-500' };
    if (lower.includes('database') || lower.includes('sql') || lower.includes('schema')) return { icon: Database, label: 'Data', color: 'text-emerald-500' };
    if (lower.includes('fix') || lower.includes('error') || lower.includes('debug')) return { icon: Wrench, label: 'Fix', color: 'text-amber-500' };
    if (lower.includes('style') || lower.includes('css') || lower.includes('design')) return { icon: Palette, label: 'UI', color: 'text-pink-500' };
    if (lower.includes('plan') || lower.includes('review')) return { icon: Search, label: 'Plan', color: 'text-blue-500' };
    if (lower.includes('auth') || lower.includes('login')) return { icon: Lock, label: 'Auth', color: 'text-orange-500' };
    if (lower.includes('api') || lower.includes('fetch')) return { icon: Zap, label: 'API', color: 'text-yellow-500' };
    return { icon: Code, label: 'Build', color: 'text-indigo-500' };
};

const ThinkingTerminal: React.FC<ThinkingTerminalProps> = ({ 
    plan, currentStepIndex, isComplete, error, onRetry, onClose,
    phases, currentPhaseIndex = 0, audit, logs
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());
  const { t, dir } = useTranslation();

  useEffect(() => {
      let timer: any;
      if (!isComplete && !error) {
          timer = setInterval(() => {
              setElapsed(Math.floor((Date.now() - startTime) / 1000));
          }, 1000);
      }
      return () => clearInterval(timer);
  }, [isComplete, error, startTime]);

  const steps = phases && phases.length > 0 ? phases.map(p => p?.title || 'Processing...') : plan;
  const currentIndex = phases && phases.length > 0 ? currentPhaseIndex : currentStepIndex;
  
  const isFailed = isComplete && error;
  const isSuccess = isComplete && !error && steps.length > 0;
  
  const currentPhase = phases ? phases[currentIndex] : null;
  const lastLog = logs && logs.length > 0 ? logs[logs.length - 1] : '';
  
  const currentStepText = steps.length === 0 
    ? t('analyzingReqs') 
    : isSuccess 
        ? t('buildComplete') 
        : isFailed 
            ? t('buildFailed') 
            : (currentPhase?.title || steps[currentIndex] || t('building'));

  const { icon: CurrentStepIcon, color: currentStepColor } = getStepInfo(currentStepText);

  return (
    <div className="w-full py-1 animate-in fade-in slide-in-from-bottom-2 font-sans" dir={dir}>
      <div className="flex gap-4">
        {/* Status Icon */}
        <div className="shrink-0 mt-0.5">
             {isFailed ? (
                <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500"><XCircle size={12} /></div>
            ) : isSuccess ? (
                <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-500"><CheckCircle2 size={12} /></div>
            ) : (
                <div className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                    <Loader2 size={12} className="text-indigo-600 dark:text-indigo-400 animate-spin" />
                </div>
            )}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
            {/* Main Status Text */}
            <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${isFailed ? 'text-red-600' : 'text-slate-800 dark:text-slate-200'}`}>
                    {currentStepText}
                </span>
                {!isComplete && <span className="text-[10px] text-slate-400 font-mono tabular-nums">{elapsed}s</span>}
            </div>

            {/* Steps List - Minimal */}
            {!isSuccess && steps.length > 0 && (
                <div className="pl-1 border-l border-slate-200 dark:border-slate-800 ml-2.5 space-y-1 pt-1 pb-1">
                    {steps.map((step, i) => {
                        const status = i < currentIndex ? 'completed' : i === currentIndex ? (isFailed ? 'failed' : 'active') : 'pending';
                        if (status === 'pending') return null;
                        
                        return (
                            <div key={i} className="flex items-start gap-2.5 text-xs">
                                <div className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${
                                    status === 'active' ? 'bg-indigo-500 animate-pulse' :
                                    status === 'completed' ? 'bg-slate-300 dark:bg-slate-600' :
                                    status === 'failed' ? 'bg-red-400' : 'bg-slate-200'
                                }`} />
                                <span className={`${status === 'active' ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'} transition-colors`}>
                                    {step}
                                </span>
                            </div>
                        );
                    })}
                    
                    {/* Active Log Line */}
                    {!isFailed && !isSuccess && lastLog && (
                        <div className="flex items-start gap-2.5 text-[10px] text-slate-400 font-mono mt-1 opacity-80">
                             <div className="mt-1 w-1 h-1 shrink-0 opacity-0"/> {/* spacer */}
                             <span className="truncate max-w-full">&gt; {lastLog}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/10 p-2 rounded border border-red-100 dark:border-red-900/20 mt-2">
                    {error}
                </div>
            )}

            {/* Retry Button */}
            {isFailed && onRetry && (
                <button onClick={onRetry} className="mt-1 text-xs flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:underline">
                    <RefreshCw size={12} /> {t('retryJob')}
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default ThinkingTerminal;
