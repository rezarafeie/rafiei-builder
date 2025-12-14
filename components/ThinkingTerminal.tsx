
import React, { useEffect, useState } from 'react';
import { 
    Loader2, CheckCircle2, AlertTriangle, XCircle, RefreshCw, X, 
    ChevronDown, ChevronUp, Layers, ArrowRight,
    Database, Wrench, Palette, Search, Code, Lock, Zap, Sparkles, Brain
} from 'lucide-react';
import { useTranslation } from '../utils/translations';
import { Phase } from '../types';

interface ThinkingTerminalProps {
  plan: string[];
  currentStepIndex: number;
  isComplete: boolean;
  error: string | null;
  onRetry?: () => void;
  onClose?: () => void;
  phases?: Phase[];
  currentPhaseIndex?: number;
}

const getStepInfo = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('analyzing') || lower.includes('requirements')) return { icon: Brain, label: 'Think', color: 'text-purple-500' };
    if (lower.includes('database') || lower.includes('sql') || lower.includes('schema') || lower.includes('table') || lower.includes('supabase')) return { icon: Database, label: 'Data', color: 'text-emerald-500' };
    if (lower.includes('fix') || lower.includes('error') || lower.includes('debug') || lower.includes('repair') || lower.includes('healing')) return { icon: Wrench, label: 'Fix', color: 'text-amber-500' };
    if (lower.includes('style') || lower.includes('css') || lower.includes('design') || lower.includes('ui') || lower.includes('tailwind') || lower.includes('layout')) return { icon: Palette, label: 'UI', color: 'text-pink-500' };
    if (lower.includes('plan') || lower.includes('review') || lower.includes('verify')) return { icon: Search, label: 'Plan', color: 'text-blue-500' };
    if (lower.includes('auth') || lower.includes('login') || lower.includes('user')) return { icon: Lock, label: 'Auth', color: 'text-orange-500' };
    if (lower.includes('api') || lower.includes('fetch') || lower.includes('connect')) return { icon: Zap, label: 'API', color: 'text-yellow-500' };
    return { icon: Code, label: 'Build', color: 'text-indigo-500' };
};

const ThinkingTerminal: React.FC<ThinkingTerminalProps> = ({ 
    plan, currentStepIndex, isComplete, error, onRetry, onClose,
    phases, currentPhaseIndex = 0
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [displayedError, setDisplayedError] = useState<string | null>(null);
  const { t, dir } = useTranslation();

  // Auto-expand on error
  useEffect(() => {
    if (error) {
        setDisplayedError(error);
        setIsExpanded(true);
    }
  }, [error]);
  
  const loadingPlan = plan.length === 0;
  const isFailed = isComplete && error;
  const isSuccess = isComplete && !error && plan.length > 0;
  const progressPercent = plan.length > 0 ? Math.round(((currentStepIndex) / plan.length) * 100) : 0;
  
  // Determine current active text
  const currentStepText = loadingPlan 
    ? t('analyzingReqs') 
    : isSuccess 
        ? t('buildComplete') 
        : isFailed 
            ? t('buildFailed') 
            : plan[currentStepIndex] || t('building');

  const { icon: CurrentStepIcon, label: currentStepLabel, color: currentStepColor } = getStepInfo(currentStepText);

  return (
    <div className="w-full max-w-lg my-4 animate-in fade-in duration-300 font-sans" dir={dir}>
      <div className={`
        relative overflow-hidden rounded-2xl border transition-all duration-300
        ${isFailed ? 'bg-red-50/50 border-red-100 dark:bg-red-950/10 dark:border-red-900/30' : 
          isSuccess ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/10 dark:border-emerald-900/30' : 
          'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}
      `}>
        
        {/* Minimal Header / Summary View */}
        <div 
            className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            onClick={() => setIsExpanded(!isExpanded)}
        >
            <div className="flex items-center gap-3 min-w-0">
                {/* Icon Status */}
                <div className="shrink-0">
                    {isFailed ? (
                        <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500"><XCircle size={16} /></div>
                    ) : isSuccess ? (
                        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-500"><CheckCircle2 size={16} /></div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center relative">
                            <Loader2 size={16} className="text-indigo-600 dark:text-indigo-400 animate-spin" />
                        </div>
                    )}
                </div>

                {/* Text Summary */}
                <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                        {!isSuccess && !isFailed && !loadingPlan && (
                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 ${currentStepColor} border border-slate-200 dark:border-slate-700`}>
                                <CurrentStepIcon size={10} />
                                <span className="uppercase">{currentStepLabel}</span>
                            </div>
                        )}
                        <span className={`text-sm font-medium truncate ${isFailed ? 'text-red-600' : isSuccess ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>
                            {currentStepText}
                        </span>
                        {phases && phases.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 font-medium whitespace-nowrap">
                                Phase {currentPhaseIndex + 1}/{phases.length}
                            </span>
                        )}
                    </div>
                    {!isSuccess && !isFailed && (
                        <div className="flex items-center gap-2 mt-1">
                            <div className="w-24 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                            </div>
                            <span className="text-xs text-slate-400">{progressPercent}%</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 pl-2">
                {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
            <div className="px-4 pb-4 pt-0 border-t border-slate-100 dark:border-slate-800/50 animate-in slide-in-from-top-1">
                {/* Steps List */}
                <div className="mt-3 space-y-2 pl-2 relative">
                     {/* Vertical Line */}
                     <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-100 dark:bg-slate-800"></div>

                     {plan.map((step, index) => {
                        const stepCompleted = index < currentStepIndex || isSuccess;
                        const stepActive = index === currentStepIndex && !isSuccess && !isFailed;
                        const stepFailed = isFailed && index === currentStepIndex;
                        
                        const { icon: StepIcon, label: stepLabel, color: stepColor } = getStepInfo(step);

                        return (
                            <div key={index} className={`relative flex items-start gap-3 text-sm py-1 ${stepActive ? 'opacity-100' : stepCompleted ? 'opacity-60' : 'opacity-40'}`}>
                                <div className={`mt-1 w-3.5 h-3.5 rounded-full border-2 shrink-0 z-10 flex items-center justify-center bg-white dark:bg-slate-900 ${
                                    stepCompleted ? 'border-emerald-500 bg-emerald-500' : 
                                    stepActive ? 'border-indigo-500 animate-pulse' : 
                                    stepFailed ? 'border-red-500 bg-red-500' :
                                    'border-slate-200 dark:border-slate-700'
                                }`}>
                                     {stepCompleted && <CheckCircle2 size={10} className="text-white" />}
                                </div>
                                <div className="flex flex-col gap-0.5 w-full min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className={`flex items-center gap-1 px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800/50 ${stepColor} border border-slate-200 dark:border-slate-700/50 shrink-0`}>
                                            <StepIcon size={8} />
                                            <span>{stepLabel}</span>
                                        </div>
                                    </div>
                                    <span className={`leading-relaxed break-words ${stepActive ? 'text-indigo-600 dark:text-indigo-400 font-medium' : stepFailed ? 'text-red-500 font-medium' : 'text-slate-600 dark:text-slate-400'}`}>
                                        {step}
                                    </span>
                                </div>
                            </div>
                        )
                     })}
                </div>

                {/* Error & Retry */}
                {isFailed && (
                    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/20">
                        <p className="text-xs text-red-600 dark:text-red-400 font-mono mb-2">{displayedError}</p>
                        {onRetry && (
                            <button onClick={onRetry} className="text-xs flex items-center gap-1.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 transition-colors">
                                <RefreshCw size={12} /> {t('retryJob')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
};

export default ThinkingTerminal;
