
import React, { useState } from 'react';
import { Project, User } from '../types';
import { useTranslation } from '../utils/translations';
import { Globe, Users, Copy, ExternalLink, Star, Check } from 'lucide-react';

interface PublishDropdownProps {
  project: Project;
  user: User;
  onManageDomains: () => void;
  onClose: () => void;
  onUpdate: () => void;
}

const PublishDropdown: React.FC<PublishDropdownProps> = ({ project, onManageDomains }) => {
    const { t, dir } = useTranslation();
    const [copied, setCopied] = useState(false);

    // Calculate dynamic preview URL
    const baseUrl = window.location.href.split('#')[0];
    const previewUrl = `${baseUrl}#/preview/${project.id}`;
    
    // Use custom domain if present, otherwise publishedUrl if present, otherwise the preview URL
    const projectUrl = project.customDomain 
        ? `https://${project.customDomain}` 
        : (project.publishedUrl || previewUrl);
    
    const handleCopy = () => {
        navigator.clipboard.writeText(projectUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="w-[90vw] max-w-[24rem] md:w-96 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl text-slate-900 dark:text-white p-4 animate-in fade-in slide-in-from-top-2 duration-200" onClick={(e) => e.stopPropagation()} dir={dir}>
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">{t('publish')}
                    {project.publishedUrl && <span className="text-xs font-medium bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-500/30">{t('live')}</span>}
                </h3>
                <div className="text-xs text-slate-500 dark:text-gray-400 flex items-center gap-1.5"><Users size={14} /> 7 {t('visitors')}</div>
            </div>

            {/* Platform Domain */}
            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-gray-700/80 rounded-lg p-2 flex items-center justify-between mb-4 gap-2">
                <a 
                    href={projectUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="bg-transparent text-sm w-full outline-none text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 hover:underline truncate block"
                    title={projectUrl}
                >
                    {projectUrl}
                </a>
                <button 
                    onClick={handleCopy} 
                    className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-gray-700 rounded flex-shrink-0 transition-colors"
                    title="Copy URL"
                >
                    {copied ? <Check size={14} className="text-green-600 dark:text-green-500" /> : <Copy size={14} />}
                </button>
            </div>

            {/* Custom Domain Section */}
            <div className="space-y-3 mb-4">
                <div className="flex items-center gap-3">
                    <Globe size={16} className="text-slate-400 dark:text-gray-400" />
                    <span className="text-sm font-semibold text-slate-700 dark:text-white">{project.customDomain || 'No custom domain'}</span>
                    {project.customDomain && <Star size={14} className="text-yellow-500 dark:text-yellow-400 fill-current" />}
                    {project.customDomain && (
                        <a href={`https://${project.customDomain}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-slate-500 hover:text-slate-900 dark:text-gray-500 dark:hover:text-white"><ExternalLink size={16}/></a>
                    )}
                </div>
                <div className="flex gap-2 text-sm">
                    <button className="bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-md flex-1 transition-colors">{t('editDomain')}</button>
                    <button onClick={onManageDomains} className="bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-md flex-1 transition-colors">{t('manageDomains')}</button>
                </div>
            </div>
        </div>
    );
};

export default PublishDropdown;
