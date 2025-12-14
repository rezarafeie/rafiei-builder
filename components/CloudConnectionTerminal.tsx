
import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Cloud, X } from 'lucide-react';
import { useTranslation } from '../utils/translations';

type Status = 'provisioning' | 'waking' | 'success' | 'error';

interface CloudConnectionTerminalProps {
  status: Status;
  error?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}

const CloudConnectionTerminal: React.FC<CloudConnectionTerminalProps> = ({ status, error, onRetry, onClose }) => {
  const { t, dir } = useTranslation();

  const isComplete = status === 'success' || status === 'error';

  return (
    <div className="w-full max-w-lg my-4 animate-in fade-in duration-300 font-sans" dir={dir}>
      <div className={`
        relative rounded-2xl border p-4 flex items-center justify-between shadow-sm transition-all
        ${status === 'error' ? 'bg-red-50/50 border-red-100 dark:bg-red-950/10 dark:border-red-900/30' : 
          status === 'success' ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/10 dark:border-emerald-900/30' : 
          'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}
      `}>
          <div className="flex items-center gap-3">
               {/* Icon */}
               <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                   status === 'error' ? 'bg-red-100 text-red-500 dark:bg-red-900/20' : 
                   status === 'success' ? 'bg-emerald-100 text-emerald-500 dark:bg-emerald-900/20' : 
                   'bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20'
               }`}>
                   {status === 'error' ? <AlertTriangle size={18} /> : 
                    status === 'success' ? <CheckCircle2 size={18} /> : 
                    <Loader2 size={18} className="animate-spin" />}
               </div>

               {/* Text */}
               <div>
                   <h4 className={`text-sm font-medium ${
                       status === 'error' ? 'text-red-700 dark:text-red-400' :
                       status === 'success' ? 'text-emerald-700 dark:text-emerald-400' :
                       'text-slate-800 dark:text-slate-200'
                   }`}>
                       {status === 'error' ? t('connectionFailedTitle') : 
                        status === 'success' ? t('cloudConnected') : 
                        status === 'provisioning' ? t('provisioningProject') : t('wakingDatabase')}
                   </h4>
                   
                   {status === 'error' ? (
                       <p className="text-xs text-red-500/80 mt-0.5">{error || t('unknownError')}</p>
                   ) : status === 'success' ? (
                       <p className="text-xs text-emerald-500/80 mt-0.5">{t('backendReady')}</p>
                   ) : (
                       <p className="text-xs text-slate-500 mt-0.5">{t('connectingCloud')}...</p>
                   )}
               </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
              {status === 'error' && onRetry && (
                  <button onClick={onRetry} className="text-xs px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-colors">
                      {t('retry')}
                  </button>
              )}
              {isComplete && (
                  <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                      <X size={16} />
                  </button>
              )}
          </div>
      </div>
    </div>
  );
};

export default CloudConnectionTerminal;
