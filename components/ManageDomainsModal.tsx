
import React, { useState, useEffect } from 'react';
import { Project, User, Domain } from '../types';
import { cloudService } from '../services/cloudService';
import { X, Globe, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react';
import { useTranslation } from '../utils/translations';

interface ManageDomainsModalProps {
  project: Project;
  user: User;
  onClose: () => void;
  onUpdate: () => void;
}

const CodeBlock: React.FC<{ value: string }> = ({ value }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="bg-slate-900/50 font-mono text-xs px-2 py-1 rounded-md flex items-center justify-between">
            <span className="text-indigo-300">{value}</span>
            <button onClick={handleCopy} className="p-1 text-slate-400 hover:text-white">
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
        </div>
    );
};

const ManageDomainsModal: React.FC<ManageDomainsModalProps> = ({ project, user, onClose, onUpdate }) => {
    const [domains, setDomains] = useState<Domain[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newDomain, setNewDomain] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const { t, dir } = useTranslation();

    const fetchDomains = async () => {
        setIsLoading(true);
        try {
            const fetched = await cloudService.getDomainsForProject(project.id);
            setDomains(fetched);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };
    
    useEffect(() => {
        fetchDomains();
    }, [project.id]);

    const handleAddDomain = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDomain) return;
        setIsAdding(true);
        try {
            await cloudService.addDomain(project.id, user.id, newDomain);
            setNewDomain('');
            await fetchDomains();
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsAdding(false);
        }
    };

    const handleDeleteDomain = async (domainId: string) => {
        if (!window.confirm("Are you sure? This will remove the domain and its configuration.")) return;
        try {
            await cloudService.deleteDomain(domainId);
            await fetchDomains();
        } catch(error: any) {
            alert(`Error: ${error.message}`);
        }
    };
    
    const handleVerifyDomain = async (domainId: string) => {
        try {
            // Optimistic update
            setDomains(prev => prev.map(d => d.id === domainId ? {...d, status: 'pending'} : d));
            const updatedDomain = await cloudService.verifyDomain(domainId);
            setDomains(prev => prev.map(d => d.id === domainId ? updatedDomain : d));
            onUpdate();
        } catch (error: any) {
             alert(`Error: ${error.message}`);
             await fetchDomains(); // Revert on error
        }
    }


    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose} dir={dir}>
            <div className="w-full max-w-3xl bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl p-8 animate-in fade-in zoom-in-95 duration-300" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2"><Globe size={20}/> {t('customDomains')}</h2>
                        <p className="text-slate-400 text-sm">{t('manageDomains')}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full text-slate-400"><X size={20}/></button>
                </div>

                <div className="bg-slate-900/50 border border-slate-700 rounded-lg max-h-[50vh] overflow-y-auto">
                    {isLoading ? <div className="p-8 text-center text-slate-500">{t('loading')}</div> : 
                    domains.length === 0 ? <div className="p-8 text-center text-slate-500">No custom domains added yet.</div> :
                    (
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-slate-900/80 backdrop-blur-sm">
                                <tr>
                                    <th className="text-left font-semibold p-3">Domain</th>
                                    <th className="text-left font-semibold p-3">{t('configuration')}</th>
                                    <th className="text-left font-semibold p-3">{t('status')}</th>
                                    <th className="p-3"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {domains.map(d => (
                                    <tr key={d.id} className="border-t border-slate-800">
                                        <td className="p-3 font-medium">{d.domainName} {d.isPrimary && <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full ml-2">{t('primary')}</span>}</td>
                                        <td className="p-3">
                                            <div className="grid grid-cols-[50px_1fr] items-center gap-x-2 gap-y-1">
                                                <span className="text-slate-500 text-right">{t('type')}</span> <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-xs font-mono w-fit">{d.dnsRecordType}</span>
                                                <span className="text-slate-500 text-right">{t('value')}</span> <CodeBlock value={d.dnsRecordValue || ''} />
                                            </div>
                                        </td>
                                        <td className="p-3">
                                            {d.status === 'verified' && <div className="flex items-center gap-1.5 text-green-400"><CheckCircle2 size={14}/> {t('verified')}</div>}
                                            {d.status === 'pending' && <button onClick={() => handleVerifyDomain(d.id)} className="flex items-center gap-1.5 text-yellow-400 hover:text-yellow-300"><Loader2 size={14} className="animate-spin"/> {t('verify')}</button>}
                                            {d.status === 'error' && <div className="flex items-center gap-1.5 text-red-400"><AlertCircle size={14}/> {t('error')}</div>}
                                        </td>
                                        <td className="p-3 text-right">
                                            <button onClick={() => handleDeleteDomain(d.id)} className="p-1.5 text-slate-500 hover:text-red-400"><Trash2 size={16}/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="mt-6 pt-6 border-t border-slate-800">
                    <h3 className="font-semibold mb-2">{t('addDomain')}</h3>
                    <form onSubmit={handleAddDomain} className="flex gap-2">
                        <input type="text" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder={t('domainPlaceholder')} className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                        <button type="submit" disabled={isAdding} className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-1.5 rounded-lg flex items-center gap-2 disabled:opacity-50">
                            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16}/>}
                            {t('add')}
                        </button>
                    </form>
                    <p className="text-xs text-slate-500 mt-2">{t('domainSupport')}</p>
                </div>
            </div>
        </div>
    );
};

export default ManageDomainsModal;
