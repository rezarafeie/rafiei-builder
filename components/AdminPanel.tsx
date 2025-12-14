
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, Project, SystemLog, AdminMetric, FinancialStats, CreditLedgerEntry, WebhookLog } from '../types';
import { cloudService } from '../services/cloudService';
import { billingService } from '../services/billingService';
import { webhookService, EventType } from '../services/webhookService';
import { PROMPT_KEYS, DEFAULTS } from '../services/geminiService';
import SqlSetupModal from './SqlSetupModal';
import { 
    Activity, Users, Box, Brain, AlertTriangle, Terminal, 
    Shield, Settings, RefreshCw, X, Database, Loader2, 
    DollarSign, TrendingUp, CreditCard, Check, Search, 
    Clock, Calendar, FileText, ChevronRight, Save, Menu, Zap, Scale, BarChart3, Radio, Send
} from 'lucide-react';

interface AdminPanelProps {
    user: User;
    onClose: () => void;
}

type AdminView = 'dashboard' | 'financials' | 'users' | 'projects' | 'ai' | 'webhooks' | 'errors' | 'settings' | 'database';

const AdminPanel: React.FC<AdminPanelProps> = ({ user, onClose }) => {
    const [view, setView] = useState<AdminView>('dashboard');
    const [projects, setProjects] = useState<Project[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [stats, setStats] = useState<AdminMetric[]>([]);
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [aiUsage, setAiUsage] = useState<any[]>([]);
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [dataError, setDataError] = useState<string | null>(null);
    
    // Financial State (Initialize with zeros)
    const [financialStats, setFinancialStats] = useState<FinancialStats>({
        totalRevenueCredits: 0,
        totalCostUsd: 0,
        netProfitUsd: 0,
        totalCreditsPurchased: 0,
        currentMargin: 0.5,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequestCount: 0
    });
    const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
    const [newMargin, setNewMargin] = useState('');
    
    // Finance Ops State
    const [userSearch, setUserSearch] = useState('');
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');
    const [targetUser, setTargetUser] = useState<any | null>(null);
    
    // Webhooks State
    const [webhookUrl, setWebhookUrl] = useState('');
    const [isSavingUrl, setIsSavingUrl] = useState(false);
    const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
    const [testEventType, setTestEventType] = useState<EventType>('admin.test_event');
    
    // UI State
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [selectedUserFinancials, setSelectedUserFinancials] = useState<any | null>(null);
    const [selectedUserTransactions, setSelectedUserTransactions] = useState<any[]>([]);
    const [showSqlWizard, setShowSqlWizard] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const loadData = async () => {
        setIsLoading(true);
        setDataError(null);
        try {
            const [adminProjects, adminUsers, systemLogs] = await Promise.all([
                cloudService.getAdminProjects(),
                cloudService.getAdminUsers(),
                cloudService.getSystemLogs()
            ]);

            setProjects(adminProjects);
            setAllUsers(adminUsers);
            setLogs(systemLogs);

            // Fetch Financials - Use cloudService to ensure authenticated session
            try {
                const fStats = await cloudService.getFinancialStats();
                const fLedger = await cloudService.getLedger(200); // Increased limit
                if (fStats) {
                    setFinancialStats(fStats);
                    setNewMargin(fStats.currentMargin.toString());
                }
                setLedger(fLedger);
            } catch (e) { 
                console.warn("Financials load error (likely empty tables or RLS):", e); 
            }

            // Metrics
            const activeUsersCount = adminUsers.filter((u: any) => {
                if (!u.last_sign_in_at) return false;
                const diff = Date.now() - new Date(u.last_sign_in_at).getTime();
                return diff < 7 * 24 * 60 * 60 * 1000;
            }).length;

            const failedBuilds = adminProjects.filter(p => p.status === 'failed' || p.buildState?.error).length;
            const successRate = adminProjects.length > 0 
                ? Math.round(((adminProjects.length - failedBuilds) / adminProjects.length) * 100) 
                : 100;

            const errorCount = systemLogs.filter(l => l.level === 'error' || l.level === 'critical').length;

            setStats([
                { label: 'Total Users', value: adminUsers.length, status: 'good' },
                { label: 'Active Users (7d)', value: activeUsersCount, status: 'good' },
                { label: 'Total Projects', value: adminProjects.length, status: 'good' },
                { label: 'Build Success Rate', value: `${successRate}%`, status: successRate < 80 ? 'warning' : 'good' },
                { label: 'Recent Errors', value: errorCount, status: errorCount > 5 ? 'critical' : 'good' },
            ]);

            // Load Prompts
            const loadedPrompts: Record<string, string> = {};
            Object.keys(PROMPT_KEYS).forEach(key => {
                // @ts-ignore
                const storageKey = PROMPT_KEYS[key];
                // @ts-ignore
                const defaultVal = DEFAULTS[key];
                loadedPrompts[key] = localStorage.getItem(storageKey) || defaultVal;
            });
            setPrompts(loadedPrompts);

        } catch (e: any) {
            console.error("Admin load failed", e);
            setDataError(e.message || "Failed to load admin data.");
            if (e.message.includes("Access Denied") || e.message.includes("Missing")) {
                setShowSqlWizard(true); 
            }
        } finally {
            setIsLoading(false);
        }
    };

    const loadWebhookData = async () => {
        try {
            const url = await cloudService.getSystemSetting('webhook_url');
            if (url) setWebhookUrl(url);
            const wLogs = await cloudService.getWebhookLogs();
            setWebhookLogs(wLogs);
        } catch(e) { console.error(e); }
    };

    useEffect(() => {
        loadData();
    }, [user.id]);

    useEffect(() => {
        if (view === 'webhooks') {
            loadWebhookData();
        }
    }, [view]);

    const handleUpdateMargin = async () => {
        const val = parseFloat(newMargin);
        if (isNaN(val) || val < 0) return alert("Invalid margin");
        try {
            await billingService.updateProfitMargin(val);
            alert("Margin updated");
            loadData();
        } catch (e: any) { alert(e.message); }
    };

    const handleUserSelect = async (u: any) => {
        setSelectedUser(u);
        try {
            const financials = await cloudService.getUserFinancialOverview(u.id);
            const transactions = await cloudService.getUserTransactions(u.id);
            setSelectedUserFinancials(financials);
            setSelectedUserTransactions(transactions);
        } catch(e) { console.error(e); setSelectedUserFinancials(null); setSelectedUserTransactions([]); }
    };

    const handleAdjustCredit = async (targetId: string, targetEmail: string) => {
        if (!adjustmentAmount || !adjustmentNote) return alert("Please fill all fields");
        const amount = parseFloat(adjustmentAmount);
        if (isNaN(amount) || amount === 0) return alert("Invalid amount");

        if(!window.confirm(`Are you sure you want to ${amount > 0 ? 'ADD' : 'DEDUCT'} ${Math.abs(amount)} credits for ${targetEmail}?`)) return;

        try {
            await cloudService.adminAdjustCredit(targetId, amount, adjustmentNote, user.email);
            alert("Adjustment successful");
            setAdjustmentAmount('');
            setAdjustmentNote('');
            loadData();
            if (selectedUser && selectedUser.id === targetId) {
                handleUserSelect(selectedUser);
            }
        } catch(e: any) {
            alert(e.message);
        }
    };

    const handleSavePrompt = (key: string, value: string) => {
        // @ts-ignore
        const storageKey = PROMPT_KEYS[key];
        localStorage.setItem(storageKey, value);
        setPrompts(prev => ({ ...prev, [key]: value }));
        alert("System prompt updated locally.");
    };

    const handleResetPrompt = (key: string) => {
        // @ts-ignore
        const storageKey = PROMPT_KEYS[key];
        localStorage.removeItem(storageKey);
        // @ts-ignore
        setPrompts(prev => ({ ...prev, [key]: DEFAULTS[key] }));
    };

    const handleSaveWebhookUrl = async () => {
        if (!webhookUrl) return alert("URL cannot be empty");
        setIsSavingUrl(true);
        try {
            await cloudService.setSystemSetting('webhook_url', webhookUrl);
            webhookService.clearCache(); // Force refresh in service
            alert("Webhook URL updated.");
        } catch(e: any) { alert(e.message); }
        finally { setIsSavingUrl(false); }
    };

    const handleTestWebhook = async () => {
        await webhookService.send(testEventType, { message: "This is a test event from the Admin Panel" }, {}, user);
        alert("Test event fired. Check logs in a moment.");
        setTimeout(loadWebhookData, 2000); // Refresh logs after a delay
    };

    const handleNavClick = (newView: AdminView) => { setView(newView); setIsSidebarOpen(false); };

    if (isLoading && stats.length === 0) {
        return <div className="h-screen bg-[#0f172a] flex items-center justify-center text-white"><Loader2 className="animate-spin mr-2" /> Loading Admin Data...</div>;
    }

    const UserDetailsModal = () => {
        if (!selectedUser) return null;
        const userProjects = projects.filter(p => p.userId === selectedUser.id);
        const userBalance = selectedUser.credits_balance !== undefined ? selectedUser.credits_balance : '...';

        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in zoom-in-95">
                <div className="bg-[#1e293b] border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                    <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-[#0f172a]">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-indigo-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                                {selectedUser.email ? selectedUser.email[0].toUpperCase() : 'U'}
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white break-all">{selectedUser.email}</h2>
                                <div className="text-xs text-slate-400 font-mono mt-1">{selectedUser.id}</div>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    <div className="text-sm px-2 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                                        Balance: {Number(userBalance).toFixed(2)} Credits
                                    </div>
                                    <div className="text-sm px-2 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded">
                                        Created: {new Date(selectedUser.created_at).toLocaleDateString()}
                                    </div>
                                    <div className="text-sm px-2 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded">
                                        Last Login: {selectedUser.last_sign_in_at ? new Date(selectedUser.last_sign_in_at).toLocaleDateString() : 'Never'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
                            <X size={24} />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 bg-[#1e293b] space-y-8">
                        
                        <section>
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><DollarSign size={18} className="text-emerald-400"/> Financial Overview</h3>
                            {selectedUserFinancials && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                                        <div className="text-xs text-slate-400 uppercase font-bold mb-1">Purchased</div>
                                        <div className="text-lg font-mono text-white">{selectedUserFinancials.totalPurchased.toFixed(2)} CR</div>
                                    </div>
                                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                                        <div className="text-xs text-slate-400 uppercase font-bold mb-1">Total Spent</div>
                                        <div className="text-lg font-mono text-white">{selectedUserFinancials.totalSpent.toFixed(2)} CR</div>
                                    </div>
                                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                                        <div className="text-xs text-slate-400 uppercase font-bold mb-1">AI Cost (USD)</div>
                                        <div className="text-lg font-mono text-white">${selectedUserFinancials.totalCost.toFixed(4)}</div>
                                    </div>
                                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                                        <div className="text-xs text-slate-400 uppercase font-bold mb-1">Profit (USD)</div>
                                        <div className="text-lg font-mono text-emerald-400">${selectedUserFinancials.profitGenerated.toFixed(4)}</div>
                                    </div>
                                </div>
                            )}
                            
                            <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                                <h4 className="text-sm font-bold text-white mb-3">Manual Credit Adjustment</h4>
                                <div className="flex gap-2 mb-2">
                                    <input 
                                        type="number" 
                                        value={adjustmentAmount}
                                        onChange={e => setAdjustmentAmount(e.target.value)}
                                        placeholder="+/- Amount"
                                        className="w-32 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
                                    />
                                    <input 
                                        type="text" 
                                        value={adjustmentNote}
                                        onChange={e => setAdjustmentNote(e.target.value)}
                                        placeholder="Reason (required)"
                                        className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white"
                                    />
                                    <button 
                                        onClick={() => handleAdjustCredit(selectedUser.id, selectedUser.email)}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded font-medium"
                                    >
                                        Execute
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><Box size={18} className="text-indigo-400"/> Projects ({userProjects.length})</h3>
                            <div className="grid gap-3 max-h-60 overflow-y-auto">
                                {userProjects.length === 0 ? <div className="text-slate-500 italic">No projects found.</div> : (
                                    userProjects.map(p => (
                                        <div key={p.id} className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex justify-between items-center">
                                            <div>
                                                <div className="font-medium text-white">{p.name}</div>
                                                <div className="text-xs text-slate-400">Updated: {new Date(p.updatedAt).toLocaleDateString()}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-1 rounded ${p.status==='generating'?'bg-indigo-900 text-indigo-200':'bg-slate-700 text-slate-300'}`}>{p.status}</span>
                                                <div className="text-xs font-mono text-slate-500">{p.id.substring(0,8)}...</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>

                        <section>
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2"><CreditCard size={18} className="text-slate-400"/> Recent Transactions</h3>
                            <div className="overflow-x-auto rounded-lg border border-slate-700">
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="bg-slate-800 text-slate-400">
                                        <tr>
                                            <th className="p-3">Date</th>
                                            <th className="p-3">Type</th>
                                            <th className="p-3">Amount</th>
                                            <th className="p-3">Description</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700 bg-slate-900/50">
                                        {selectedUserTransactions.length === 0 ? (
                                            <tr><td colSpan={4} className="p-4 text-center text-slate-500">No transactions found.</td></tr>
                                        ) : (
                                            selectedUserTransactions.slice(0, 10).map((tx, i) => (
                                                <tr key={i}>
                                                    <td className="p-3 whitespace-nowrap">{new Date(tx.createdAt).toLocaleDateString()}</td>
                                                    <td className="p-3"><span className="bg-slate-800 px-2 py-0.5 rounded text-xs">{tx.type}</span></td>
                                                    <td className={`p-3 font-mono font-bold ${tx.amount > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{tx.amount}</td>
                                                    <td className="p-3 text-xs text-slate-400 truncate max-w-[200px]">{tx.description}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen bg-[#0f172a] text-slate-300 font-sans overflow-hidden">
            <UserDetailsModal />
            {showSqlWizard && (
                <SqlSetupModal 
                    isOpen={true} 
                    errorType={dataError || "MANUAL_TRIGGER"} 
                    onRetry={loadData} 
                    onClose={() => setShowSqlWizard(false)} 
                />
            )}

            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div 
                    className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm animate-in fade-in"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-50 w-64 bg-[#1e293b] border-r border-slate-700 flex flex-col shrink-0 transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="p-4 border-b border-slate-700 font-bold text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Shield className="text-indigo-500" /> Admin Panel
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800">
                        <X size={20} />
                    </button>
                </div>
                <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
                    {[
                        { id: 'dashboard', label: 'Dashboard', icon: Activity },
                        { id: 'financials', label: 'Financials', icon: DollarSign },
                        { id: 'users', label: 'Users', icon: Users },
                        { id: 'projects', label: 'Projects', icon: Box },
                        { id: 'ai', label: 'AI Engine', icon: Brain },
                        { id: 'webhooks', label: 'Webhooks', icon: Radio },
                        { id: 'errors', label: 'Error Center', icon: AlertTriangle },
                        { id: 'settings', label: 'System Settings', icon: Settings },
                        { id: 'database', label: 'System Database', icon: Database },
                    ].map(item => (
                        <button
                            key={item.id}
                            onClick={() => handleNavClick(item.id as AdminView)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === item.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
                        >
                            <item.icon size={18} />
                            {item.label}
                        </button>
                    ))}
                </nav>
                <div className="p-4 border-t border-slate-700">
                    <button onClick={onClose} className="w-full text-center text-sm text-slate-500 hover:text-white transition-colors">Exit Admin</button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 border-b border-slate-700 flex items-center justify-between px-4 md:px-6 bg-[#0f172a]">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
                            <Menu size={24} />
                        </button>
                        <h2 className="text-xl font-semibold text-white capitalize">{view}</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={view === 'webhooks' ? loadWebhookData : loadData} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white" title="Refresh Data">
                            <RefreshCw size={16} />
                        </button>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 md:p-6">
                    {/* Error Banner */}
                    {dataError && (
                        <div className="mb-6 bg-red-900/20 border border-red-500/30 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="text-red-400 shrink-0" />
                                <div>
                                    <h4 className="text-red-200 font-bold">Data Access Error</h4>
                                    <p className="text-red-300 text-sm">{dataError}</p>
                                </div>
                            </div>
                            <button onClick={() => setShowSqlWizard(true)} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium whitespace-nowrap">Run Fix Script</button>
                        </div>
                    )}

                    {/* DASHBOARD VIEW */}
                    {view === 'dashboard' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {stats.map((stat, i) => (
                                <div key={i} className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="text-slate-400 text-sm font-medium mb-2">{stat.label}</div>
                                    <div className={`text-3xl font-bold ${
                                        stat.status === 'good' ? 'text-white' : 
                                        stat.status === 'warning' ? 'text-yellow-400' : 'text-red-400'
                                    }`}>
                                        {stat.value}
                                    </div>
                                </div>
                            ))}
                            {/* Added AI Cost Card */}
                            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                <div className="text-slate-400 text-sm font-medium mb-2">Total AI Usage Cost</div>
                                <div className="text-3xl font-bold text-white">${financialStats.totalCostUsd.toFixed(4)}</div>
                            </div>
                        </div>
                    )}

                    {/* WEBHOOKS VIEW */}
                    {view === 'webhooks' && (
                        <div className="space-y-6 max-w-5xl mx-auto">
                            {/* Configuration */}
                            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Radio size={18} className="text-indigo-400"/> Webhook Configuration</h3>
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <label className="text-xs text-slate-400 font-medium mb-1 block">Unified Webhook URL (Make.com / Zapier)</label>
                                        <input 
                                            type="text" 
                                            value={webhookUrl}
                                            onChange={e => setWebhookUrl(e.target.value)}
                                            placeholder="https://hook.make.com/..."
                                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                                        />
                                    </div>
                                    <div className="flex items-end">
                                        <button 
                                            onClick={handleSaveWebhookUrl}
                                            disabled={isSavingUrl}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium h-[42px] w-[100px] flex items-center justify-center"
                                        >
                                            {isSavingUrl ? <Loader2 className="animate-spin" /> : 'Save'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Test Console */}
                            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Send size={18} className="text-emerald-400"/> Test Console</h3>
                                <div className="flex items-center gap-4">
                                    <select 
                                        value={testEventType} 
                                        onChange={(e) => setTestEventType(e.target.value as EventType)}
                                        className="bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white outline-none flex-1"
                                    >
                                        <option value="admin.test_event">admin.test_event</option>
                                        <option value="user.logged_in">user.logged_in</option>
                                        <option value="project.created">project.created</option>
                                        <option value="build.started">build.started</option>
                                        <option value="credit.used">credit.used</option>
                                        <option value="credit.purchase_completed">credit.purchase_completed</option>
                                        <option value="cloud.connection_requested">cloud.connection_requested</option>
                                        <option value="system.error">system.error</option>
                                    </select>
                                    <button 
                                        onClick={handleTestWebhook}
                                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"
                                    >
                                        <Send size={16} /> Fire Event
                                    </button>
                                </div>
                            </div>

                            {/* Recent Logs */}
                            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                                <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                                    <span className="font-semibold text-white">Recent Delivery Logs</span>
                                    <button onClick={loadWebhookData} className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><RefreshCw size={12}/> Refresh</button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-900 text-slate-400">
                                            <tr>
                                                <th className="p-3">Time</th>
                                                <th className="p-3">Status</th>
                                                <th className="p-3">Event Type</th>
                                                <th className="p-3">Payload Preview</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700">
                                            {webhookLogs.length === 0 ? (
                                                <tr><td colSpan={4} className="p-8 text-center text-slate-500">No logs found.</td></tr>
                                            ) : (
                                                webhookLogs.map((log) => (
                                                    <tr key={log.id} className="hover:bg-slate-700/30">
                                                        <td className="p-3 text-slate-400 whitespace-nowrap text-xs">{new Date(log.created_at).toLocaleString()}</td>
                                                        <td className="p-3">
                                                            <span className={`px-2 py-1 rounded text-xs font-bold ${log.status_code >= 200 && log.status_code < 300 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                                                                {log.status_code || 'ERR'}
                                                            </span>
                                                        </td>
                                                        <td className="p-3 font-mono text-white text-xs">{log.event_type}</td>
                                                        <td className="p-3 text-slate-400 text-xs font-mono max-w-[300px] truncate" title={JSON.stringify(log.payload, null, 2)}>
                                                            {JSON.stringify(log.payload)}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FINANCIALS VIEW */}
                    {view === 'financials' && (
                        <div className="space-y-6">
                            {/* Stats */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <CreditCard size={18} className="text-indigo-400" />
                                        <div className="text-slate-400 text-sm font-medium">Revenue (Credits)</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{financialStats.totalRevenueCredits.toFixed(2)}</div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <DollarSign size={18} className="text-red-400" />
                                        <div className="text-slate-400 text-sm font-medium">Cost (USD)</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">${financialStats.totalCostUsd.toFixed(4)}</div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <TrendingUp size={18} className="text-emerald-400" />
                                        <div className="text-slate-400 text-sm font-medium">Net Profit</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">${financialStats.netProfitUsd.toFixed(4)}</div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col justify-between">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Settings size={18} className="text-slate-400" />
                                        <div className="text-slate-400 text-sm font-medium">Profit Margin %</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <input 
                                            type="number" 
                                            step="0.01"
                                            value={newMargin} 
                                            onChange={e => setNewMargin(e.target.value)} 
                                            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 w-full text-white"
                                        />
                                        <button onClick={handleUpdateMargin} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded">Save</button>
                                    </div>
                                </div>
                            </div>

                            {/* Manual Ops Consolidated */}
                            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4"><CreditCard size={20} className="text-emerald-400"/> Manual Adjustment</h3>
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            placeholder="Find user by email..." 
                                            value={userSearch}
                                            onChange={e => setUserSearch(e.target.value)}
                                            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white"
                                        />
                                        <button 
                                            onClick={() => {
                                                const found = allUsers.find(u => u.email.includes(userSearch));
                                                setTargetUser(found || null);
                                                if(!found) alert("User not found");
                                            }}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg"
                                        >
                                            Search
                                        </button>
                                    </div>
                                    {targetUser && (
                                        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex items-center gap-4">
                                            <div className="flex-1">
                                                <div className="font-bold text-white">{targetUser.email}</div>
                                                <div className="text-sm text-slate-400">Balance: <span className="text-emerald-400 font-mono">{targetUser.credits_balance}</span></div>
                                            </div>
                                            <input 
                                                type="number" 
                                                value={adjustmentAmount}
                                                onChange={e => setAdjustmentAmount(e.target.value)}
                                                placeholder="+/- Amount"
                                                className="w-32 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                                            />
                                            <input 
                                                type="text" 
                                                value={adjustmentNote}
                                                onChange={e => setAdjustmentNote(e.target.value)}
                                                placeholder="Reason"
                                                className="w-48 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                                            />
                                            <button 
                                                onClick={() => handleAdjustCredit(targetUser.id, targetUser.email)}
                                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-medium"
                                            >
                                                Execute
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Ledger */}
                            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                                <div className="p-4 border-b border-slate-700 font-semibold text-white">Global Ledger</div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-900 text-slate-400">
                                            <tr>
                                                <th className="p-3">Time</th>
                                                <th className="p-3">User</th>
                                                <th className="p-3">Action</th>
                                                <th className="p-3">Model</th>
                                                <th className="p-3 text-right">Tokens (I/O)</th>
                                                <th className="p-3 text-right">Cost (USD)</th>
                                                <th className="p-3 text-right">Charged (Credits)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700">
                                            {ledger.map((entry, i) => (
                                                <tr key={i} className="hover:bg-slate-700/30">
                                                    <td className="p-3 text-slate-400 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                                                    <td className="p-3 font-mono text-slate-500">{entry.userId.substring(0, 8)}...</td>
                                                    <td className="p-3">
                                                        <span className="bg-slate-900 px-2 py-1 rounded text-xs">{entry.operationType}</span>
                                                    </td>
                                                    <td className="p-3 text-slate-300 text-xs">{entry.model}</td>
                                                    <td className="p-3 text-right font-mono text-xs">{entry.inputTokens} / {entry.outputTokens}</td>
                                                    <td className="p-3 text-right font-mono text-slate-400">${entry.rawCostUsd.toFixed(5)}</td>
                                                    <td className="p-3 text-right font-bold text-white">{entry.creditsDeducted.toFixed(4)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* USERS VIEW */}
                    {view === 'users' && (
                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm min-w-[800px]">
                                    <thead className="bg-slate-900 text-slate-400">
                                        <tr>
                                            <th className="p-4">User</th>
                                            <th className="p-4">Credits</th>
                                            <th className="p-4">Projects</th>
                                            <th className="p-4">Created</th>
                                            <th className="p-4">Last Seen</th>
                                            <th className="p-4"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {allUsers.map(u => (
                                            <tr key={u.id} className="hover:bg-slate-700/50 cursor-pointer" onClick={() => handleUserSelect(u)}>
                                                <td className="p-4">
                                                    <div className="font-bold text-white">{u.email}</div>
                                                    <div className="text-xs text-slate-500 font-mono">{u.id}</div>
                                                </td>
                                                <td className="p-4 font-mono text-emerald-400">{Number(u.credits_balance || 0).toFixed(2)}</td>
                                                <td className="p-4">{u.project_count}</td>
                                                <td className="p-4 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                                                <td className="p-4 text-slate-400">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}</td>
                                                <td className="p-4"><ChevronRight size={16} className="text-slate-500"/></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* PROJECTS VIEW */}
                    {view === 'projects' && (
                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-900 text-slate-400">
                                        <tr>
                                            <th className="p-4">Project Name</th>
                                            <th className="p-4">Owner</th>
                                            <th className="p-4">Status</th>
                                            <th className="p-4">Created</th>
                                            <th className="p-4">Updated</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {projects.map(p => (
                                            <tr key={p.id} className="hover:bg-slate-700/50">
                                                <td className="p-4 font-medium text-white">
                                                    <Link to={`/project/${p.id}`} className="text-indigo-400 hover:text-indigo-300 hover:underline transition-colors">
                                                        {p.name}
                                                    </Link>
                                                </td>
                                                <td className="p-4 text-slate-400 font-mono text-xs">{p.userId}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs ${p.status === 'generating' ? 'bg-indigo-900 text-indigo-200' : 'bg-slate-700 text-slate-300'}`}>
                                                        {p.status}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                                                <td className="p-4 text-slate-400">{new Date(p.updatedAt).toLocaleDateString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* AI ENGINE VIEW */}
                    {view === 'ai' && (
                        <div className="space-y-6">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <DollarSign size={18} className="text-red-400" />
                                        <div className="text-slate-400 text-sm font-medium">Total AI Cost</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">${financialStats.totalCostUsd.toFixed(4)}</div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Scale size={18} className="text-emerald-400" />
                                        <div className="text-slate-400 text-sm font-medium">Platform Profit</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">${financialStats.netProfitUsd.toFixed(4)}</div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Zap size={18} className="text-indigo-400" />
                                        <div className="text-slate-400 text-sm font-medium">Total Tokens</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">
                                        {((financialStats.totalInputTokens || 0) + (financialStats.totalOutputTokens || 0)).toLocaleString()}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        I: {(financialStats.totalInputTokens || 0).toLocaleString()} / O: {(financialStats.totalOutputTokens || 0).toLocaleString()}
                                    </div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <BarChart3 size={18} className="text-blue-400" />
                                        <div className="text-slate-400 text-sm font-medium">Total Requests</div>
                                    </div>
                                    <div className="text-2xl font-bold text-white">{financialStats.totalRequestCount || 0}</div>
                                </div>
                            </div>

                            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                                <div className="p-4 border-b border-slate-700 font-semibold text-white">Detailed Usage Log (Ledger)</div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-900 text-slate-400">
                                            <tr>
                                                <th className="p-3">Time</th>
                                                <th className="p-3">Model</th>
                                                <th className="p-3">Input Tokens</th>
                                                <th className="p-3">Output Tokens</th>
                                                <th className="p-3">Cost</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700">
                                            {ledger.length === 0 ? (
                                                <tr><td colSpan={5} className="p-8 text-center text-slate-500">No usage data found.</td></tr>
                                            ) : (
                                                ledger.map((row: any, i: number) => (
                                                    <tr key={i} className="hover:bg-slate-700/30">
                                                        <td className="p-3 text-slate-400">{new Date(row.createdAt).toLocaleString()}</td>
                                                        <td className="p-3 text-white">{row.model}</td>
                                                        <td className="p-3 font-mono text-slate-400">{row.inputTokens}</td>
                                                        <td className="p-3 font-mono text-slate-400">{row.outputTokens}</td>
                                                        <td className="p-3 font-mono text-emerald-400">${Number(row.rawCostUsd).toFixed(5)}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ERROR CENTER VIEW */}
                    {view === 'errors' && (
                        <div className="space-y-4">
                            {logs.filter(l => l.level === 'error' || l.level === 'critical').length === 0 ? (
                                <div className="text-center p-8 text-slate-500 bg-slate-800 rounded-xl border border-slate-700">No critical errors found.</div>
                            ) : (
                                logs.filter(l => l.level === 'error' || l.level === 'critical').map(log => (
                                    <div key={log.id} className="bg-red-900/10 border border-red-900/30 p-4 rounded-xl">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <AlertTriangle size={16} className="text-red-500" />
                                                <span className="font-bold text-red-400 uppercase text-xs">{log.level}</span>
                                                <span className="text-slate-500 text-xs">{new Date(log.timestamp).toLocaleString()}</span>
                                            </div>
                                            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded">{log.source}</span>
                                        </div>
                                        <p className="text-white text-sm font-mono">{log.message}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* SETTINGS VIEW */}
                    {view === 'settings' && (
                        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-6">
                            <h3 className="text-lg font-bold text-white mb-4">System Prompts</h3>
                            <div className="grid gap-6">
                                {Object.entries(PROMPT_KEYS).map(([key, storageKey]) => (
                                    <div key={key} className="space-y-2">
                                        <div className="flex justify-between">
                                            <label className="text-sm font-medium text-slate-300">{key}</label>
                                            <button onClick={() => handleResetPrompt(key)} className="text-xs text-slate-500 hover:text-white">Reset to Default</button>
                                        </div>
                                        <textarea
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-300 h-32 focus:outline-none focus:border-indigo-500"
                                            value={prompts[key] || ''}
                                            onChange={(e) => setPrompts(prev => ({...prev, [key]: e.target.value}))}
                                        />
                                        <button onClick={() => handleSavePrompt(key, prompts[key] || '')} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded">Save</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* DATABASE VIEW (System Config) */}
                    {view === 'database' && (
                        <div className="max-w-4xl mx-auto space-y-6">
                            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                                    <Database size={20} className="text-indigo-400" />
                                    System Database Configuration
                                </h3>
                                <p className="text-slate-400 text-sm mb-6">
                                    Ensure all required tables, RLS policies, and RPC functions are installed on the Supabase backend.
                                    If you encounter "Table not found" or "Access Denied" errors, run the wizard below.
                                </p>
                                
                                <div className="flex items-center gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800 mb-6">
                                    <div className={`p-3 rounded-full ${dataError ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                        {dataError ? <AlertTriangle size={24} /> : <Check size={24} />}
                                    </div>
                                    <div>
                                        <h4 className={`font-bold ${dataError ? 'text-red-400' : 'text-emerald-400'}`}>
                                            {dataError ? 'Connection Issue Detected' : 'System Operational'}
                                        </h4>
                                        <p className="text-xs text-slate-500">
                                            {dataError || 'Core tables accessible. RLS policies active.'}
                                        </p>
                                    </div>
                                </div>

                                <button 
                                    onClick={() => setShowSqlWizard(true)}
                                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition-all shadow-lg shadow-indigo-500/20"
                                >
                                    <Terminal size={18} />
                                    Run SQL Setup Wizard
                                </button>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default AdminPanel;
